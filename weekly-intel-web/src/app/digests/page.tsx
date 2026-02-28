"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";

interface Digest {
  id: number;
  weekNumber: string;
  dateRange: string | null;
  sourcesCount: number;
  itemsCount: number;
  generatedAt: string;
}

export default function DigestsPage() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchDigests();
  }, []);

  async function fetchDigests() {
    try {
      const res = await fetch("/api/digests");
      const data = await res.json();
      setDigests(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function generateDigest() {
    setGenerating(true);
    try {
      await fetch("/api/digests", { method: "POST" });
      fetchDigests();
    } catch (e) {
      console.error(e);
    }
    setGenerating(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Digests</h2>
          <p className="text-muted-foreground">
            Weekly intelligence digests
          </p>
        </div>
        <Button onClick={generateDigest} disabled={generating}>
          {generating ? "Generating..." : "Generate Digest"}
        </Button>
      </div>

      {digests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No digests yet</p>
            <Button onClick={generateDigest} disabled={generating}>
              Generate your first digest
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {digests.map((digest) => (
            <Link key={digest.id} href={`/digests/${digest.weekNumber}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        Week {digest.weekNumber}
                      </span>
                      {digest.dateRange && (
                        <span className="text-sm text-muted-foreground">
                          {digest.dateRange}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span>{digest.sourcesCount} sources</span>
                      <span>{digest.itemsCount} items</span>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(digest.generatedAt).toLocaleDateString()}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
