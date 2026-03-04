"use client";

import useSWR from "swr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface ContentItem {
  id: number;
  title: string | null;
  author: string | null;
  url: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  source: { id: number; name: string; type: string } | null;
  isProcessed: boolean;
}

export default function ContentPage() {
  const { data, error } = useSWR("/api/content?limit=100", fetcher, {
    refreshInterval: 60000,
  });

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load content</p>
      </div>
    );
  }

  const items: ContentItem[] = data?.items || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Content</h1>
        <p className="mt-1 text-muted-foreground">
          All ingested content items
        </p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <p className="text-muted-foreground">No content items yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add sources and run ingestion to see content here
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Published</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="max-w-md truncate font-medium">
                      {item.title || "Untitled"}
                    </div>
                    {item.author && (
                      <div className="text-sm text-muted-foreground">
                        by {item.author}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.source && (
                      <Badge variant="outline">{item.source.name}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.publishedAt
                      ? new Date(item.publishedAt).toLocaleDateString()
                      : new Date(item.ingestedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.isProcessed ? "default" : "secondary"}>
                      {item.isProcessed ? "Processed" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
