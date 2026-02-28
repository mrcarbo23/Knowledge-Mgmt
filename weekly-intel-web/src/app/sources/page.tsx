"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface Source {
  id: number;
  name: string;
  sourceType: string;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSource, setNewSource] = useState({
    name: "",
    sourceType: "substack",
    config: {} as Record<string, string>,
  });

  useEffect(() => {
    fetchSources();
  }, []);

  async function fetchSources() {
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      setSources(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function addSource() {
    try {
      await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSource),
      });
      setDialogOpen(false);
      setNewSource({ name: "", sourceType: "substack", config: {} });
      fetchSources();
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleSource(id: number, active: boolean) {
    try {
      await fetch(`/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      fetchSources();
    } catch (e) {
      console.error(e);
    }
  }

  async function deleteSource(id: number) {
    if (!confirm("Delete this source?")) return;
    try {
      await fetch(`/api/sources/${id}`, { method: "DELETE" });
      fetchSources();
    } catch (e) {
      console.error(e);
    }
  }

  function getConfigField(): { label: string; key: string; placeholder: string } {
    switch (newSource.sourceType) {
      case "substack":
        return {
          label: "Feed URL",
          key: "url",
          placeholder: "https://example.substack.com/feed",
        };
      case "gmail":
        return {
          label: "Label",
          key: "label",
          placeholder: "Newsletters",
        };
      case "youtube":
        return {
          label: "Channel ID or Video URLs (comma-separated)",
          key: "channelId",
          placeholder: "UCxxxxxx",
        };
      default:
        return { label: "Config", key: "url", placeholder: "" };
    }
  }

  const configField = getConfigField();

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
          <h2 className="text-3xl font-bold tracking-tight">Sources</h2>
          <p className="text-muted-foreground">
            Manage content sources for ingestion
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Source</DialogTitle>
              <DialogDescription>
                Add a new content source for ingestion.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={newSource.name}
                  onChange={(e) =>
                    setNewSource({ ...newSource, name: e.target.value })
                  }
                  placeholder="My Newsletter"
                />
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={newSource.sourceType}
                  onValueChange={(v) =>
                    setNewSource({ ...newSource, sourceType: v, config: {} })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="substack">Substack</SelectItem>
                    <SelectItem value="gmail">Gmail</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{configField.label}</Label>
                <Input
                  value={(newSource.config[configField.key] as string) ?? ""}
                  onChange={(e) =>
                    setNewSource({
                      ...newSource,
                      config: {
                        ...newSource.config,
                        [configField.key]: e.target.value,
                      },
                    })
                  }
                  placeholder={configField.placeholder}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addSource} disabled={!newSource.name}>
                Add Source
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">No sources configured</p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{source.name}</span>
                      <Badge variant="secondary">{source.sourceType}</Badge>
                      <Badge variant={source.active ? "success" : "outline"}>
                        {source.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {JSON.stringify(source.config)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSource(source.id, source.active)}
                  >
                    {source.active ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteSource(source.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
