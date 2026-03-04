"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface Source {
  id: number;
  name: string;
  sourceType: string;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export default function SourcesPage() {
  const { data, error, mutate } = useSWR("/api/sources", fetcher);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("");
  const [configValue, setConfigValue] = useState("");

  const getConfigLabel = (type: string) => {
    switch (type) {
      case "substack":
        return "Feed URL";
      case "youtube":
        return "Channel ID";
      case "gmail":
        return "Label";
      default:
        return "Config";
    }
  };

  const getConfigPlaceholder = (type: string) => {
    switch (type) {
      case "substack":
        return "https://example.substack.com/feed";
      case "youtube":
        return "UCxxxxxxxxxxxxxx";
      case "gmail":
        return "newsletter";
      default:
        return "";
    }
  };

  const handleCreate = async () => {
    if (!name || !sourceType) {
      toast.error("Please fill in all required fields");
      return;
    }

    const config: Record<string, unknown> = {};
    if (sourceType === "substack" && configValue) {
      config.feedUrl = configValue;
    } else if (sourceType === "youtube" && configValue) {
      config.channelId = configValue;
    } else if (sourceType === "gmail" && configValue) {
      config.label = configValue;
    }

    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sourceType, config }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Source created successfully");
        mutate();
        setDialogOpen(false);
        setName("");
        setSourceType("");
        setConfigValue("");
      }
    } catch {
      toast.error("Failed to create source");
    }
  };

  const handleToggle = async (source: Source) => {
    try {
      const res = await fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !source.active }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(`Source ${source.active ? "deactivated" : "activated"}`);
        mutate();
      }
    } catch {
      toast.error("Failed to update source");
    }
  };

  const handleDelete = async (sourceId: number) => {
    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Source deleted successfully");
        mutate();
      }
    } catch {
      toast.error("Failed to delete source");
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load sources</p>
      </div>
    );
  }

  const sources: Source[] = data?.sources || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Sources</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your content sources
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
              <DialogTitle>Add New Source</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="My Newsletter"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select value={sourceType} onValueChange={setSourceType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="substack">Substack</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="gmail">Gmail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {sourceType && (
                <div className="space-y-2">
                  <Label htmlFor="config">{getConfigLabel(sourceType)}</Label>
                  <Input
                    id="config"
                    placeholder={getConfigPlaceholder(sourceType)}
                    value={configValue}
                    onChange={(e) => setConfigValue(e.target.value)}
                  />
                </div>
              )}
              <Button onClick={handleCreate} className="w-full">
                Create Source
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No sources configured yet</p>
            <Button
              variant="link"
              onClick={() => setDialogOpen(true)}
              className="mt-2"
            >
              Add your first source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{source.name}</CardTitle>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="outline" className="capitalize">
                      {source.sourceType}
                    </Badge>
                    <Badge variant={source.active ? "default" : "secondary"}>
                      {source.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-4">
                  <pre className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {JSON.stringify(source.config)}
                  </pre>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggle(source)}
                  >
                    {source.active ? (
                      <ToggleRight className="mr-1 h-4 w-4" />
                    ) : (
                      <ToggleLeft className="mr-1 h-4 w-4" />
                    )}
                    {source.active ? "Deactivate" : "Activate"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Source</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete &quot;{source.name}&quot;? This
                          action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(source.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
