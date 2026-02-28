"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, FileText, BookOpen, Cog } from "lucide-react";

interface Stats {
  sources: number;
  contentItems: number;
  processedItems: number;
  digests: number;
  recentJobs: Array<{
    id: number;
    jobType: string;
    status: string;
    startedAt: string;
  }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function triggerJob(type: string) {
    setTriggering(type);
    try {
      const endpoint =
        type === "ingest"
          ? "/api/ingest"
          : type === "process"
            ? "/api/process"
            : "/api/digests";
      await fetch(endpoint, { method: "POST" });
      // Refresh stats
      const res = await fetch("/api/stats");
      setStats(await res.json());
    } catch (e) {
      console.error(e);
    }
    setTriggering(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Weekly Intel overview and quick actions
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sources ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Content Items</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.contentItems ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.processedItems ?? 0} processed
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Digests</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.digests ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Jobs</CardTitle>
            <Cog className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.recentJobs?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button
            onClick={() => triggerJob("ingest")}
            disabled={triggering !== null}
          >
            {triggering === "ingest" ? "Ingesting..." : "Ingest Now"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => triggerJob("process")}
            disabled={triggering !== null}
          >
            {triggering === "process" ? "Processing..." : "Process Now"}
          </Button>
          <Button
            variant="outline"
            onClick={() => triggerJob("digest")}
            disabled={triggering !== null}
          >
            {triggering === "digest" ? "Generating..." : "Generate Digest"}
          </Button>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
      {stats?.recentJobs && stats.recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between border-b pb-3 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        job.status === "completed"
                          ? "success"
                          : job.status === "failed"
                            ? "destructive"
                            : "warning"
                      }
                    >
                      {job.status}
                    </Badge>
                    <span className="text-sm font-medium capitalize">
                      {job.jobType}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(job.startedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
