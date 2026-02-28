"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface JobRun {
  id: number;
  jobType: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchJobs() {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

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
      fetchJobs();
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
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Jobs</h2>
        <p className="text-muted-foreground">
          Trigger and monitor background jobs
        </p>
      </div>

      {/* Triggers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manual Triggers</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button
            onClick={() => triggerJob("ingest")}
            disabled={triggering !== null}
          >
            {triggering === "ingest" ? "Running..." : "Run Ingestion"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => triggerJob("process")}
            disabled={triggering !== null}
          >
            {triggering === "process" ? "Running..." : "Run Processing"}
          </Button>
          <Button
            variant="outline"
            onClick={() => triggerJob("digest")}
            disabled={triggering !== null}
          >
            {triggering === "digest" ? "Running..." : "Generate Digest"}
          </Button>
        </CardContent>
      </Card>

      {/* Job History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Job History</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground">No jobs have been run yet</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start justify-between border-b pb-3 last:border-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
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
                      <span className="font-medium capitalize">
                        {job.jobType}
                      </span>
                    </div>
                    {job.error && (
                      <p className="text-sm text-destructive mt-1">
                        {job.error}
                      </p>
                    )}
                    {job.result && (
                      <pre className="text-xs text-muted-foreground mt-1 bg-muted rounded p-2">
                        {JSON.stringify(job.result, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground text-right">
                    <div>{new Date(job.startedAt).toLocaleString()}</div>
                    {job.completedAt && (
                      <div className="text-xs">
                        Duration:{" "}
                        {(
                          (new Date(job.completedAt).getTime() -
                            new Date(job.startedAt).getTime()) /
                          1000
                        ).toFixed(1)}
                        s
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
