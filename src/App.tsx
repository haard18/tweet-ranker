import React, { useState, useEffect } from "react";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface CSVRow {
  [key: string]: string;
}

interface ProcessedResult {
  url: any;
  id: number;
  createdAt: string;
  updatedAt: string;
  originalTweetText: string;
  replyText: string;
  score: string | number;
  tweetId: string;
  jobid: string;
  ranking?: number;
}

interface WebhookResponse {
  status: "processing" | "done";
  results?: ProcessedResult[];
  [key: string]: any;
}

interface JobResponse {
  jobId: string;
}

const TweetRankerApp: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<ProcessedResult[] | null>(null);
  const [summary, setSummary] = useState<{
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    totalProcessed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobSubmitted, setJobSubmitted] = useState<boolean>(false);
  const [fetchingResults, setFetchingResults] = useState<boolean>(false);
  const [polling, setPolling] = useState<boolean>(false);
  const [pollingInterval, setPollingInterval] = useState<number | null>(null);

  // Replace with your actual n8n webhook URLs
  const WEBHOOK_URL: string =
    "https://n8n.elcarainternal.lol/webhook-test/c981f5ea-99ce-4a36-9f8a-e4eb63c98d27";

  // Add your results endpoint URL here
  const RESULTS_URL: string =
    "https://n8n.elcarainternal.lol/webhook-test/5a83a88a-1072-4c52-8144-fbb9eaaf4d53/results"; // Update with actual URL

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "text/csv") {
      // Stop any ongoing polling
      stopPolling();

      setFile(selectedFile);
      setError(null);
      setResults(null);
      setSummary(null);
      setJobId(null);
      setJobSubmitted(false);
    } else {
      setError("Please select a valid CSV file");
      setFile(null);
    }
  };

  const parseCSV = (text: string): CSVRow[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    const headers = lines[0].split(",").map((h) => h.trim());

    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim());
      const obj: CSVRow = {};
      headers.forEach((header, i) => {
        obj[header] = values[i] || "";
      });
      return obj;
    });
  };

  const processFile = async (): Promise<void> => {
    if (!file) {
      setError("Please select a file first");
      return;
    }

    // Stop any ongoing polling
    stopPolling();

    setLoading(true);
    setError(null);
    setProgress(0);
    setSummary(null);
    setJobId(null);
    setJobSubmitted(false);

    try {
      // Read CSV file
      const text = await file.text();
      const csvData = parseCSV(text);

      setProgress(25);

      console.log("Sending data:", csvData); // Debug log

      // Submit job to n8n workflow
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: csvData,
          filename: file.name,
          totalRows: csvData.length,
        }),
      });

      setProgress(75);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: JobResponse = await response.json();
      console.log("Received job response:", data); // Debug log

      if (data.jobId) {
        setJobId(data.jobId);
        setJobSubmitted(true);
        setProgress(100);
      } else {
        throw new Error("No job ID received from server");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(
        errorMessage ||
          "Failed to submit job. Please check your n8n webhook URL."
      );
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    setPolling(false);
    setFetchingResults(false);
  };

  const checkResults = async (
    isAutoPolling: boolean = false
  ): Promise<boolean> => {
    if (!jobId) {
      setError("No job ID available");
      return false;
    }

    if (!isAutoPolling) {
      setFetchingResults(true);
      setError(null);
    }

    try {
      // Fetch results using job ID
      const response = await fetch(`${RESULTS_URL}/${jobId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          if (!isAutoPolling) {
            // Don't show error, just start polling
            startPolling();
          }
          return false; // Still processing
        }
        throw new Error(`Server error: ${response.status}`);
      }

      // Check if response has content before trying to parse JSON
      const responseText = await response.text();
      if (!responseText || responseText.trim() === "") {
        console.log("Empty response, continuing to poll...");
        if (!isAutoPolling) {
          startPolling();
        }
        return false; // No data yet, continue polling
      }

      let rawData;
      try {
        rawData = JSON.parse(responseText);
      } catch (parseError) {
        console.log("Failed to parse JSON, response text:", responseText);
        if (!isAutoPolling) {
          startPolling();
        }
        return false; // Invalid JSON, continue polling
      }

      console.log("Received results:", rawData); // Debug log

      // Handle array wrapper - the response comes as an array with one object
      let data: WebhookResponse;
      if (Array.isArray(rawData) && rawData.length > 0) {
        data = rawData[0];
      } else if (rawData && typeof rawData === "object") {
        data = rawData;
      } else {
        console.log("Unexpected response format:", rawData);
        return false;
      }

      // Check status
      if (data.status === "processing") {
        if (!isAutoPolling) {
          // Don't show error, just start polling
          startPolling();
        }
        return false;
      }

      if (data.status === "done") {
        if (data.results && data.results.length > 0) {
          // Process results
          const processedResults = data.results
            .map((result) => ({
              ...result,
              ranking:
                typeof result.score === "string"
                  ? parseInt(result.score)
                  : result.score,
            }))
            .sort((a, b) => {
              const scoreA =
                typeof a.score === "string" ? parseInt(a.score) : a.score;
              const scoreB =
                typeof b.score === "string" ? parseInt(b.score) : b.score;
              return scoreB - scoreA;
            });

          setResults(processedResults);

          // Calculate summary
          const scores = processedResults.map((r) =>
            typeof r.score === "string" ? parseInt(r.score) : r.score
          );
          setSummary({
            totalProcessed: processedResults.length,
            averageScore:
              scores.reduce((sum, score) => sum + score, 0) / scores.length,
            highestScore: Math.max(...scores),
            lowestScore: Math.min(...scores),
          });

          // Stop polling if it was running
          if (isAutoPolling) {
            stopPolling();
          }
          return true;
        } else {
          // No results available yet, continue polling
          if (!isAutoPolling) {
            startPolling();
          }
          return false;
        }
      }

      return false;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      // Only show errors for non-polling requests or actual server errors
      if (
        !isAutoPolling ||
        !(err instanceof Error && err.message.includes("Results not ready"))
      ) {
        setError(errorMessage);
      }
      console.error("Error fetching results:", err);
      if (isAutoPolling) {
        stopPolling();
      }
      return false;
    } finally {
      if (!isAutoPolling) {
        setFetchingResults(false);
      }
    }
  };

  const startPolling = () => {
    setPolling(true);
    setFetchingResults(true);
    const interval = setInterval(async () => {
      const isDone = await checkResults(true);
      if (isDone) {
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 3000); // Poll every 3 seconds
    setPollingInterval(interval);
  };

  const getResults = async (): Promise<void> => {
    const isDone = await checkResults(false);
    if (!isDone) {
      // If not done, start auto-polling
      startPolling();
    }
  };

  const downloadResults = (): void => {
    if (!results) return;

    const csvContent = convertToCSV(results);
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ranked_${file?.name || "results.csv"}`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const convertToCSV = (data: ProcessedResult[]): string => {
    if (!Array.isArray(data) || data.length === 0) return "";

    const headers = [
      "id",
      "tweetId",
      "replyText",
      "originalTweetText",
      "score",
      "ranking",
      "jobid",
      "tweetlink",
    ];

    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      // Escape double quotes by doubling them
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = data.map((row) =>
      headers
        .map((header) => escapeCSV(row[header as keyof ProcessedResult]))
        .join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-3">
            Tweet Reply Ranker
          </h1>
          <p className="text-gray-600">
            Upload your CSV to analyze and rank Twitter replies using AI
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          {/* Upload Section */}
          <div className="mb-8">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Upload CSV File
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                disabled={loading || fetchingResults}
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center"
              >
                <Upload className="w-12 h-12 text-gray-400 mb-3" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : "Click to upload or drag and drop"}
                </span>
                <span className="text-xs text-gray-500 mt-1">
                  CSV files only
                </span>
              </label>
            </div>
          </div>

          {/* Job Status */}
          {jobSubmitted && jobId && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800">
                    Job Submitted Successfully
                  </p>
                  <p className="text-sm text-blue-700 mt-1">Job ID: {jobId}</p>
                  <p className="text-xs text-blue-600 mt-1">
                    {polling
                      ? "Auto-polling for results every 3 seconds. Waiting for data to become available..."
                      : 'Your request is being processed. Click "Get Results" to check if it\'s ready.'}
                  </p>
                </div>
                {polling && (
                  <button
                    onClick={stopPolling}
                    className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 transition-colors"
                  >
                    Stop Polling
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {loading && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Submitting job...
                </span>
                <span className="text-sm text-gray-600">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Submit Job Button */}
            <button
              onClick={processFile}
              disabled={!file || loading || fetchingResults}
              className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting Job...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Submit Analysis Job
                </>
              )}
            </button>

            {/* Get Results Button */}
            {jobSubmitted && jobId && (
              <button
                onClick={getResults}
                disabled={fetchingResults || polling}
                className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {fetchingResults || polling ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {polling ? "Auto-polling..." : "Checking Results..."}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Get Results
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Results Section */}
        {results && results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-green-500" />
                <h2 className="text-2xl font-bold text-gray-800">
                  Results Ready
                </h2>
              </div>
              <button
                onClick={downloadResults}
                className="flex items-center gap-2 bg-green-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors"
              >
                <Download className="w-5 h-5" />
                Download CSV
              </button>
            </div>

            {/* Summary Statistics */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-blue-600">
                    Total Processed
                  </p>
                  <p className="text-2xl font-bold text-blue-800">
                    {summary.totalProcessed}
                  </p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-green-600">
                    Highest Score
                  </p>
                  <p className="text-2xl font-bold text-green-800">
                    {summary.highestScore}/10
                  </p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-yellow-600">
                    Average Score
                  </p>
                  <p className="text-2xl font-bold text-yellow-800">
                    {summary.averageScore.toFixed(1)}/10
                  </p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-red-600">
                    Lowest Score
                  </p>
                  <p className="text-2xl font-bold text-red-800">
                    {summary.lowestScore}/10
                  </p>
                </div>
              </div>
            )}

            {/* Results Preview */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      Tweet ID
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      Reply
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      Tweet Link
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      Ranking
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 10).map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-3 px-4 text-gray-600">
                        {row.tweetId || `Item ${idx + 1}`}
                      </td>
                      <td className="py-3 px-4 text-gray-800 max-w-md truncate">
                        {row.replyText}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            View Tweet
                          </a>
                        ) : (
                          <span className="text-gray-400">No link</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const rawScore = row.score || row.ranking || 0;
                          const score =
                            typeof rawScore === "string"
                              ? parseInt(rawScore)
                              : rawScore;
                          let bgColor = "bg-gray-100";
                          let textColor = "text-gray-800";

                          if (score >= 8) {
                            bgColor = "bg-green-100";
                            textColor = "text-green-800";
                          } else if (score >= 6) {
                            bgColor = "bg-blue-100";
                            textColor = "text-blue-800";
                          } else if (score >= 4) {
                            bgColor = "bg-yellow-100";
                            textColor = "text-yellow-800";
                          } else if (score >= 1) {
                            bgColor = "bg-red-100";
                            textColor = "text-red-800";
                          }

                          return (
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${bgColor} ${textColor}`}
                            >
                              {score}/10
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 10 && (
                <p className="text-center text-sm text-gray-500 mt-4">
                  Showing 10 of {results.length} results. Download CSV for full
                  data.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-blue-50 rounded-xl p-6">
          <h3 className="font-semibold text-gray-800 mb-3">📋 Instructions</h3>
          <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
            <li>
              Upload your CSV file containing tweet data with tweetId column
            </li>
            <li>Click "Submit Analysis Job" to start processing</li>
            <li>
              Wait for job confirmation, then click "Get Results" - auto-polling
              will start if results aren't ready
            </li>
            <li>
              The system will automatically check for results every 3 seconds
              until complete
            </li>
            <li>Download the results with rankings when ready</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default TweetRankerApp;
