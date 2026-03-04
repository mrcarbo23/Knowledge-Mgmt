"use client";

import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Rss,
  FileText,
  Newspaper,
  Clock,
  RefreshCw,
  Cpu,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function DashboardPage() {
  const { data, error, mutate } = useSWR("/api/stats", fetcher, {
    refreshInterval: 30000,
  });
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: string, url: string, method = "POST") => {
    setLoading(action);
    try {
      const res = await fetch(url, { method });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(`${action} completed successfully`);
        mutate();
      }
    } catch {
      toast.error(`Failed to ${action.toLowerCase()}`);
    } finally {
      setLoading(null);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load dashboard data</p>
      </div>
    );
  }

  const stats = data?.stats || { sources: 0, contentItems: 0, processedItems: 0, digests: 0 };
  const recentJobs = data?.recentJobs || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Overview of your intelligence digest system
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sources</CardTitle>
            <Rss className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.sources}</div>
            <p className="text-xs text-muted-foreground">Active content sources</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Content Items</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.contentItems}</div>
            <p className="text-xs text-muted-foreground">
              {stats.processedItems} processed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Digests</CardTitle>
            <Newspaper className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.digests}</div>
            <p className="text-xs text-muted-foreground">Weekly digests generated</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Jobs</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recentJobs.length}</div>
            <p className="text-xs text-muted-foreground">In the last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            onClick={() => handleAction("Ingest", "/api/ingest")}
            disabled={loading === "Ingest"}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading === "Ingest" ? "animate-spin" : ""}`} />
            Ingest Now
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleAction("Process", "/api/process")}
            disabled={loading === "Process"}
          >
            <Cpu className={`mr-2 h-4 w-4 ${loading === "Process" ? "animate-spin" : ""}`} />
            Process Now
          </Button>
          <Button
            variant="outline"
            onClick={() => handleAction("Generate Digest", "/api/digests")}
            disabled={loading === "Generate Digest"}
          >
            <Mail className={`mr-2 h-4 w-4 ${loading === "Generate Digest" ? "animate-spin" : ""}`} />
            Generate Digest
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {recentJobs.slice(0, 5).map((job: {
                id: number;
                jobType: string;
                status: string;
                startedAt: string;
              }) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        job.status === "completed"
                          ? "default"
                          : job.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {job.status}
                    </Badge>
                    <span className="font-medium capitalize">{job.jobType}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(job.startedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
