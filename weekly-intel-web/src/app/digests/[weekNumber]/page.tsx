"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

interface DigestData {
  id: number;
  weekNumber: string;
  dateRange: string;
  sourcesCount: number;
  itemsCount: number;
  htmlContent: string | null;
  markdownContent: string | null;
  digestData: {
    executiveSummary?: string[];
    themes?: Array<{
      name: string;
      synthesizedSummary: string;
      sources: string[];
      isNovel: boolean;
      isFollowup: boolean;
    }>;
    hotTakes?: Array<{
      take: string;
      source: string;
      author: string;
      assessment: string;
    }>;
    signalsToWatch?: string[];
    sourceIndex?: Array<{
      name: string;
      sourceType: string;
      itemCount: number;
    }>;
  } | null;
  generatedAt: string;
}

export default function DigestViewerPage() {
  const params = useParams();
  const weekNumber = params.weekNumber as string;
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"structured" | "html" | "markdown">(
    "structured"
  );

  useEffect(() => {
    fetch(`/api/digests?weekNumber=${weekNumber}`)
      .then((res) => res.json())
      .then((data) => setDigest(Array.isArray(data) ? data[0] : data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [weekNumber]);

  async function sendEmail() {
    setSending(true);
    try {
      await fetch(`/api/digests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekNumber, action: "send" }),
      });
    } catch (e) {
      console.error(e);
    }
    setSending(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="space-y-4">
        <Link href="/digests">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Digests
          </Button>
        </Link>
        <p className="text-muted-foreground">Digest not found</p>
      </div>
    );
  }

  const data = digest.digestData;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/digests">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold">Week {digest.weekNumber}</h2>
            <p className="text-muted-foreground">
              {digest.dateRange} | {digest.sourcesCount} sources |{" "}
              {digest.itemsCount} items
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md">
            {(["structured", "html", "markdown"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                } first:rounded-l-md last:rounded-r-md`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <Button onClick={sendEmail} disabled={sending} variant="outline">
            <Mail className="mr-2 h-4 w-4" />
            {sending ? "Sending..." : "Send Email"}
          </Button>
        </div>
      </div>

      {view === "html" && digest.htmlContent ? (
        <Card>
          <CardContent className="p-0">
            <iframe
              srcDoc={digest.htmlContent}
              className="w-full min-h-[600px] border-0"
              title="Digest HTML preview"
            />
          </CardContent>
        </Card>
      ) : view === "markdown" && digest.markdownContent ? (
        <Card>
          <CardContent className="py-4">
            <pre className="whitespace-pre-wrap text-sm font-mono">
              {digest.markdownContent}
            </pre>
          </CardContent>
        </Card>
      ) : data ? (
        <div className="space-y-6">
          {/* Executive Summary */}
          {data.executiveSummary && data.executiveSummary.length > 0 && (
            <Card className="bg-blue-50 border-blue-200">
              <CardHeader>
                <CardTitle className="text-lg">
                  This Week in 30 Seconds
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.executiveSummary.map((point, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-blue-600 font-bold">-</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Themes */}
          {data.themes && data.themes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xl font-semibold">Key Themes</h3>
              {data.themes.map((theme, i) => (
                <Card key={i}>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant={
                          theme.isFollowup
                            ? "warning"
                            : theme.isNovel
                              ? "success"
                              : "secondary"
                        }
                      >
                        {theme.isFollowup
                          ? "Follow-up"
                          : theme.isNovel
                            ? "New"
                            : "Ongoing"}
                      </Badge>
                      <span className="font-medium">{theme.name}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {theme.synthesizedSummary}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sources: {theme.sources.join(", ")}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Hot Takes */}
          {data.hotTakes && data.hotTakes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xl font-semibold">Hot Takes</h3>
              {data.hotTakes.map((take, i) => (
                <Card key={i}>
                  <CardContent className="py-4 border-l-4 border-red-500">
                    <p className="font-medium">
                      {take.author}{" "}
                      <span className="text-muted-foreground font-normal">
                        ({take.source})
                      </span>
                    </p>
                    <p className="text-sm mt-1">{take.take}</p>
                    {take.assessment && (
                      <p className="text-sm text-muted-foreground italic mt-1">
                        {take.assessment}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Signals */}
          {data.signalsToWatch && data.signalsToWatch.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Signals to Watch</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.signalsToWatch.map((signal, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-yellow-600 font-bold">-</span>
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Source Index */}
          {data.sourceIndex && data.sourceIndex.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Source Index</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Source</th>
                      <th className="text-center py-2">Items</th>
                      <th className="text-left py-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourceIndex.map((source, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2">{source.name}</td>
                        <td className="text-center py-2">
                          {source.itemCount}
                        </td>
                        <td className="py-2">{source.sourceType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">
          No structured data available for this digest.
        </p>
      )}
    </div>
  );
}
