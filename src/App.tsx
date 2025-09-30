import React, { useState } from "react";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";

interface CSVRow {
  [key: string]: string;
}

interface ProcessedResult {
  tweetId: string;
  replyText: string;
  originalTweetText: string;
  score: number;
  ranking: number;
}

interface WebhookResponse {
  results?: ProcessedResult[];
  data?: ProcessedResult[];
  [key: string]: any;
}

const TweetRankerApp: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<ProcessedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);

  // Replace with your actual n8n webhook URL
  const WEBHOOK_URL: string =
    "https://n8n.srv899043.hstgr.cloud/webhook-test/c981f5ea-99ce-4a36-9f8a-e4eb63c98d27";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "text/csv") {
      setFile(selectedFile);
      setError(null);
      setResults(null);
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

    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      // Read CSV file
      const text = await file.text();
      const csvData = parseCSV(text);

      setProgress(25);

      console.log("Sending data:", csvData); // Debug log

      // Send each row separately OR send as an array - depends on n8n setup
      // Option 1: Send all rows in one request
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: csvData, // Changed from csvData to items - common n8n format
          filename: file.name,
          totalRows: csvData.length,
        }),
      });

      setProgress(75);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data: WebhookResponse = await response.json();
      console.log("Received response:", data); // Debug log
      setProgress(100);

      // Handle different response formats
      const processedResults =
        data.results ||
        data.data ||
        data.items ||
        (Array.isArray(data) ? data : []);
      setResults(processedResults as ProcessedResult[]);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(
        errorMessage ||
          "Failed to process file. Please check your n8n webhook URL."
      );
      console.error("Error:", err);
    } finally {
      setLoading(false);
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

    const headers = Object.keys(data[0]);
    const rows = data.map((row) =>
      headers
        .map((header) => `"${row[header as keyof ProcessedResult] || ""}"`)
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
                disabled={loading}
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
                  Processing...
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

          {/* Process Button */}
          <button
            onClick={processFile}
            disabled={!file || loading}
            className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Analyze & Rank Replies
              </>
            )}
          </button>
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
                      <td className="py-3 px-4 text-gray-600">{row.tweetId}</td>
                      <td className="py-3 px-4 text-gray-800 max-w-md truncate">
                        {row.replyText}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-indigo-100 text-indigo-800">
                          {row.score || row.ranking || "N/A"}/10
                        </span>
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
            <li>Click "Analyze & Rank Replies" to process</li>
            <li>Wait for the AI analysis to complete</li>
            <li>Download the results with rankings added</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default TweetRankerApp;
