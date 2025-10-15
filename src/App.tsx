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
  url?: string | null;
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
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [completedJobIds, setCompletedJobIds] = useState<Set<string>>(new Set());
  const [totalBatches, setTotalBatches] = useState<number>(0);
  const [jobSubmitted, setJobSubmitted] = useState<boolean>(false);
  const [fetchingResults, setFetchingResults] = useState<boolean>(false);
  const [polling, setPolling] = useState<boolean>(false);
  const [pollingInterval, setPollingInterval] = useState<number | null>(null);

  // Replace with your actual n8n webhook URLs
  const WEBHOOK_URL: string =
    "https://n8n.elcarainternal.lol/webhook/c981f5ea-99ce-4a36-9f8a-e4eb63c98d27";

  // Add your results endpoint URL here
  const RESULTS_URL: string =
    "https://n8n.elcarainternal.lol/webhook/5a83a88a-1072-4c52-8144-fbb9eaaf4d53/results"; // Update with actual URL

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
    setJobIds([]);
    setCompletedJobIds(new Set());
    setTotalBatches(0);
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
    setJobIds([]);
    setCompletedJobIds(new Set());
    setTotalBatches(0);
    setJobSubmitted(false);

    try {
      // Read CSV file
      const text = await file.text();
      const csvData = parseCSV(text);

      console.log("Preparing CSV with", csvData.length, "rows for batching...");
      setProgress(10);

      // Chunk into batches of 50
      const chunkSize = 50;
      const chunks: CSVRow[][] = [];
      for (let i = 0; i < csvData.length; i += chunkSize) {
        chunks.push(csvData.slice(i, i + chunkSize));
      }
      setTotalBatches(chunks.length);

      const collectedJobIds: string[] = [];
      for (let idx = 0; idx < chunks.length; idx++) {
        const batch = chunks[idx];
        const response = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batch,
            filename: file.name,
            totalRows: batch.length,
            batchIndex: idx,
            totalBatches: chunks.length,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server error (batch ${idx + 1}/${chunks.length}): ${response.status}`);
        }

        const data: JobResponse = await response.json();
        if (!data.jobId) {
          throw new Error(`No job ID received from server for batch ${idx + 1}`);
        }
        collectedJobIds.push(data.jobId);

        // Update submission progress up to 95%
        const base = 10;
        const submitPortion = 85;
        const submitProgress = Math.round(base + (submitPortion * (idx + 1)) / chunks.length);
        setProgress(Math.min(submitProgress, 95));
      }

      setJobIds(collectedJobIds);
      setJobId(collectedJobIds[0] ?? null);
      setJobSubmitted(true);
      setProgress(100);
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
    const pendingJobIds = jobIds.length > 0 ? jobIds : (jobId ? [jobId] : []);
    if (pendingJobIds.length === 0) {
      setError("No job ID available");
      return false;
    }

    if (!isAutoPolling) {
      setFetchingResults(true);
      setError(null);
    }

    try {
      // For multi-batch: query all pending jobs that are not completed yet
      const currentCompleted = new Set(completedJobIds);

      const jobsToQuery = pendingJobIds.filter((id) => !currentCompleted.has(id));
      if (jobsToQuery.length === 0) {
        // All jobs already completed
        return true;
      }

      let newResults: ProcessedResult[] = [];
      let anyProcessing = false;

      // Fetch all in parallel
      const responses = await Promise.all(
        jobsToQuery.map(async (id) => {
          try {
            const resp = await fetch(`${RESULTS_URL}/${id}`, {
              method: "GET",
              headers: { "Content-Type": "application/json" },
            });
            if (!resp.ok) {
              if (resp.status === 404) {
                // Not ready yet
                anyProcessing = true;
                return null;
              }
              throw new Error(`Server error: ${resp.status}`);
            }

            const text = await resp.text();
            if (!text || text.trim() === "") {
              anyProcessing = true;
              return null;
            }
            let payload: any;
            try {
              payload = JSON.parse(text);
            } catch {
              anyProcessing = true;
              return null;
            }

            const data: WebhookResponse = Array.isArray(payload) && payload.length > 0 ? payload[0] : payload;
            if (!data || typeof data !== "object") {
              anyProcessing = true;
              return null;
            }

            if (data.status === "processing") {
              anyProcessing = true;
              return null;
            }

            if (data.status === "done" && Array.isArray(data.results) && data.results.length > 0) {
              // Mark job complete and collect results
              currentCompleted.add(id);
              return data.results as ProcessedResult[];
            }

            // No results yet
            anyProcessing = true;
            return null;
          } catch (e) {
            console.error(`Error fetching results for job ${id}:`, e);
            anyProcessing = true;
            return null;
          }
        })
      );

      // Merge collected results
      for (const arr of responses) {
        if (Array.isArray(arr)) {
          newResults = newResults.concat(arr);
        }
      }

      if (newResults.length > 0) {
        // Process, merge, sort and set
        const processedNew = newResults.map((result) => ({
          ...result,
          ranking:
            typeof result.score === "string" ? parseInt(result.score) : result.score,
        }));

        setResults((prev) => {
          const combined = [...(prev ?? []), ...processedNew];
          // Deduplicate by id if available, else by tweetId+replyText
          const seen = new Set<string | number>();
          const deduped: ProcessedResult[] = [];
          for (const item of combined) {
            const key = (item.id as unknown as string) ?? `${item.tweetId}:${item.replyText}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduped.push(item);
            }
          }
          deduped.sort((a, b) => {
            const scoreA = typeof a.score === "string" ? parseInt(a.score) : a.score;
            const scoreB = typeof b.score === "string" ? parseInt(b.score) : b.score;
            return (scoreB || 0) - (scoreA || 0);
          });
          // Update summary too
          if (deduped.length > 0) {
            const scores = deduped.map((r) => (typeof r.score === "string" ? parseInt(r.score) : r.score) || 0);
            setSummary({
              totalProcessed: deduped.length,
              averageScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
              highestScore: Math.max(...scores),
              lowestScore: Math.min(...scores),
            });
          }
          return deduped;
        });
      }

      // Persist completed job IDs
      setCompletedJobIds(new Set(currentCompleted));

      const allDone = currentCompleted.size === pendingJobIds.length;
      if (allDone && isAutoPolling) {
        stopPolling();
      } else if (!isAutoPolling && !allDone) {
        // Kick off polling if user-initiated and not complete yet
        startPolling();
      }
      return allDone && !anyProcessing;
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
    const interval = window.setInterval(async () => {
      const isDone = await checkResults(true);
      if (isDone) {
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 3000);
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
      "url",
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
          {jobSubmitted && (jobId || jobIds.length > 0) && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800">
                    Job Submitted Successfully
                  </p>
                  {jobIds.length > 1 ? (
                    <>
                      <p className="text-sm text-blue-700 mt-1">Batches: {jobIds.length}</p>
                      <p className="text-xs text-blue-600 mt-1">
                        Completed {completedJobIds.size}/{totalBatches || jobIds.length} batches
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-blue-700 mt-1">Job ID: {jobId}</p>
                  )}
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
