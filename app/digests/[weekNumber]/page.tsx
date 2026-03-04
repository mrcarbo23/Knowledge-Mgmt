"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Mail, Send } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface DigestTheme {
  name: string;
  summary: string;
  noveltyStatus: "new" | "follow-up" | "ongoing";
  items: {
    title: string;
    author?: string;
    source: string;
    url?: string;
    keyPoints: string[];
  }[];
}

interface DigestHotTake {
  take: string;
  context: string;
  source: string;
  author?: string;
}

interface DigestContent {
  weekNumber: string;
  dateRange: string;
  executiveSummary: string[];
  signalsToWatch: string[];
  themes: DigestTheme[];
  hotTakes: DigestHotTake[];
  sourceIndex: { name: string; type: string; itemCount: number }[];
  generatedAt: string;
}

interface Digest {
  id: number;
  weekNumber: string;
  dateRange: string | null;
  markdownContent: string | null;
  htmlContent: string | null;
  digestData: DigestContent | null;
}

export default function DigestViewerPage({
  params,
}: {
  params: Promise<{ weekNumber: string }>;
}) {
  const { weekNumber } = use(params);
  const { data, error } = useSWR(
    `/api/digests?weekNumber=${weekNumber}`,
    fetcher
  );
  const [sending, setSending] = useState(false);

  const handleSendEmail = async () => {
    const digest = data?.digest as Digest;
    if (!digest) return;

    setSending(true);
    try {
      const res = await fetch("/api/digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", digestId: digest.id }),
      });
      const result = await res.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Email sent to ${result.sent} recipient(s)`);
      }
    } catch {
      toast.error("Failed to send email");
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load digest</p>
      </div>
    );
  }

  const digest = data?.digest as Digest | null;

  if (!digest) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const digestContent = digest.digestData;

  const statusColors = {
    new: "bg-green-500",
    "follow-up": "bg-yellow-500",
    ongoing: "bg-gray-500",
  };

  const statusLabels = {
    new: "New",
    "follow-up": "Follow-up",
    ongoing: "Ongoing",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/digests">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Week {digest.weekNumber}
            </h1>
            <p className="mt-1 text-muted-foreground">{digest.dateRange}</p>
          </div>
        </div>
        <Button onClick={handleSendEmail} disabled={sending}>
          <Mail className="mr-2 h-4 w-4" />
          {sending ? "Sending..." : "Send Email"}
        </Button>
      </div>

      <Tabs defaultValue="structured">
        <TabsList>
          <TabsTrigger value="structured">Structured</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="markdown">Markdown</TabsTrigger>
        </TabsList>

        <TabsContent value="structured" className="space-y-6 mt-6">
          {digestContent && (
            <>
              {/* Executive Summary */}
              <Card className="border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20">
                <CardHeader>
                  <CardTitle className="text-blue-700 dark:text-blue-300">
                    Executive Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {digestContent.executiveSummary.map((point, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-blue-500">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Themes */}
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Key Themes</h2>
                {digestContent.themes.map((theme, idx) => (
                  <Card key={idx}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <span>
                          {idx + 1}. {theme.name}
                        </span>
                        <Badge
                          className={`${statusColors[theme.noveltyStatus]} text-white`}
                        >
                          {statusLabels[theme.noveltyStatus]}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground mb-4">
                        {theme.summary}
                      </p>
                      {theme.items.length > 1 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Related Items:</h4>
                          <ul className="text-sm space-y-1">
                            {theme.items.map((item, itemIdx) => (
                              <li key={itemIdx}>
                                {item.url ? (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {item.title}
                                  </a>
                                ) : (
                                  item.title
                                )}{" "}
                                <span className="text-muted-foreground">
                                  ({item.source})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Hot Takes */}
              {digestContent.hotTakes.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">Hot Takes</h2>
                  <div className="space-y-3">
                    {digestContent.hotTakes.slice(0, 10).map((take, idx) => (
                      <Card
                        key={idx}
                        className="border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20"
                      >
                        <CardContent className="pt-4">
                          <p className="font-medium">{take.take}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {take.author && `${take.author} via `}
                            {take.source} — {take.context}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Signals to Watch */}
              {digestContent.signalsToWatch.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Signals to Watch</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {digestContent.signalsToWatch.map((signal, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Send className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          <span>{signal}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Source Index */}
              <Card>
                <CardHeader>
                  <CardTitle>Source Index</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Items</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {digestContent.sourceIndex.map((source, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {source.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {source.type}
                            </Badge>
                          </TableCell>
                          <TableCell>{source.itemCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="html" className="mt-6">
          {digest.htmlContent && (
            <div className="rounded-lg border border-border overflow-hidden">
              <iframe
                srcDoc={digest.htmlContent}
                className="w-full h-[800px] bg-white"
                title="Digest HTML Preview"
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="markdown" className="mt-6">
          {digest.markdownContent && (
            <Card>
              <CardContent className="pt-6">
                <pre className="whitespace-pre-wrap font-mono text-sm">
                  {digest.markdownContent}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
