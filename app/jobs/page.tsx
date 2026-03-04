"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RefreshCw, Cpu, Newspaper, Eye } from "lucide-react";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface Job {
  id: number;
  jobType: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export default function JobsPage() {
  const { data, error, mutate } = useSWR("/api/jobs?limit=50", fetcher, {
    refreshInterval: 10000,
  });
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const handleAction = async (action: string, url: string) => {
    setLoading(action);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(`${action} job started`);
        mutate();
      }
    } catch {
      toast.error(`Failed to start ${action.toLowerCase()} job`);
    } finally {
      setLoading(null);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load jobs</p>
      </div>
    );
  }

  const jobs: Job[] = data?.jobs || [];

  const statusVariants: Record<string, "default" | "destructive" | "secondary"> = {
    completed: "default",
    failed: "destructive",
    running: "secondary",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Jobs</h1>
        <p className="mt-1 text-muted-foreground">
          Background job management and history
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manual Triggers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            onClick={() => handleAction("Ingest", "/api/ingest")}
            disabled={loading === "Ingest"}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading === "Ingest" ? "animate-spin" : ""}`}
            />
            Run Ingestion
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleAction("Process", "/api/process")}
            disabled={loading === "Process"}
          >
            <Cpu
              className={`mr-2 h-4 w-4 ${loading === "Process" ? "animate-spin" : ""}`}
            />
            Run Processing
          </Button>
          <Button
            variant="outline"
            onClick={() => handleAction("Digest", "/api/digests")}
            disabled={loading === "Digest"}
          >
            <Newspaper
              className={`mr-2 h-4 w-4 ${loading === "Digest" ? "animate-spin" : ""}`}
            />
            Generate Digest
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job History</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No jobs have been run yet
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const startTime = new Date(job.startedAt);
                  const endTime = job.completedAt
                    ? new Date(job.completedAt)
                    : null;
                  const duration = endTime
                    ? Math.round(
                        (endTime.getTime() - startTime.getTime()) / 1000
                      )
                    : null;

                  return (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-sm">
                        {job.id}
                      </TableCell>
                      <TableCell className="capitalize">{job.jobType}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariants[job.status] || "secondary"}>
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {startTime.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {duration !== null ? `${duration}s` : "—"}
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedJob(job)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>
                                Job #{selectedJob?.id} Details
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-4">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="font-medium">Type:</span>{" "}
                                  <span className="capitalize">
                                    {selectedJob?.jobType}
                                  </span>
                                </div>
                                <div>
                                  <span className="font-medium">Status:</span>{" "}
                                  <Badge
                                    variant={
                                      statusVariants[selectedJob?.status || ""] ||
                                      "secondary"
                                    }
                                  >
                                    {selectedJob?.status}
                                  </Badge>
                                </div>
                                <div>
                                  <span className="font-medium">Started:</span>{" "}
                                  {selectedJob?.startedAt
                                    ? new Date(
                                        selectedJob.startedAt
                                      ).toLocaleString()
                                    : "—"}
                                </div>
                                <div>
                                  <span className="font-medium">Completed:</span>{" "}
                                  {selectedJob?.completedAt
                                    ? new Date(
                                        selectedJob.completedAt
                                      ).toLocaleString()
                                    : "—"}
                                </div>
                              </div>
                              {selectedJob?.error && (
                                <div>
                                  <span className="font-medium text-destructive">
                                    Error:
                                  </span>
                                  <pre className="mt-2 rounded bg-destructive/10 p-3 text-sm text-destructive overflow-x-auto">
                                    {selectedJob.error}
                                  </pre>
                                </div>
                              )}
                              {selectedJob?.result && (
                                <div>
                                  <span className="font-medium">Result:</span>
                                  <pre className="mt-2 rounded bg-muted p-3 text-sm overflow-x-auto">
                                    {JSON.stringify(selectedJob.result, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
