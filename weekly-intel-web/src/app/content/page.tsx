"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ContentItem {
  id: number;
  title: string | null;
  author: string | null;
  url: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  sourceName: string;
  sourceType: string;
  isProcessed: boolean;
}

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchContent();
  }, [filter]);

  async function fetchContent() {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/content${params}`);
      const data = await res.json();
      setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
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
          <h2 className="text-3xl font-bold tracking-tight">Content</h2>
          <p className="text-muted-foreground">
            Browse ingested content items
          </p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Items</SelectItem>
            <SelectItem value="unprocessed">Unprocessed</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">No content items found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline truncate"
                        >
                          {item.title ?? "Untitled"}
                        </a>
                      ) : (
                        <span className="font-medium truncate">
                          {item.title ?? "Untitled"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {item.author && <span>{item.author}</span>}
                      <Badge variant="secondary" className="text-xs">
                        {item.sourceType}
                      </Badge>
                      <span>{item.sourceName}</span>
                      {item.publishedAt && (
                        <span>
                          {new Date(item.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant={item.isProcessed ? "success" : "outline"}>
                    {item.isProcessed ? "Processed" : "Pending"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
