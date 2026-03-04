"use client";

import useSWR from "swr";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, FileText, Rss, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface Digest {
  id: number;
  weekNumber: string;
  dateRange: string | null;
  sourcesCount: number | null;
  itemsCount: number | null;
  generatedAt: string;
}

export default function DigestsPage() {
  const { data, error, mutate } = useSWR("/api/digests", fetcher);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/digests", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Digest generated successfully");
        mutate();
      }
    } catch {
      toast.error("Failed to generate digest");
    } finally {
      setGenerating(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load digests</p>
      </div>
    );
  }

  const digests: Digest[] = data?.digests || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Digests</h1>
          <p className="mt-1 text-muted-foreground">
            Weekly intelligence digests
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate New Digest"}
        </Button>
      </div>

      {digests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No digests generated yet</p>
            <Button
              variant="link"
              onClick={handleGenerate}
              disabled={generating}
              className="mt-2"
            >
              Generate your first digest
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {digests.map((digest) => (
            <Card key={digest.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Week {digest.weekNumber}</span>
                  <Badge variant="outline">{digest.dateRange}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Rss className="h-4 w-4" />
                    <span>{digest.sourcesCount || 0} sources</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>{digest.itemsCount || 0} items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {new Date(digest.generatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <Link href={`/digests/${digest.weekNumber}`}>
                  <Button variant="outline" className="mt-4 w-full">
                    View Digest
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
