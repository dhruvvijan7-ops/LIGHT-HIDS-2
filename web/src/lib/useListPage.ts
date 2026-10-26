/* List-page data hook: load a {items, next} page, expose retry + cursor stack. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type Page } from "./api";
import { useAuth } from "./auth";

export interface ListState<T> {
  items: T[];
  next: string | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  goNext: () => void;
  goPrev: () => void;
  pageDepth: number;
  canGoPrev: boolean;
}

export function useListPage<T>(
  path: (ws: string) => string,
  query?: Record<string, string | number | boolean | undefined | null>,
): ListState<T> {
  const { session } = useAuth();
  const ws = session?.workspaceId ?? "";
  const key = session?.apiKey ?? "";

  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [depth, setDepth] = useState(0);
  const cursorStack = useRef<string[]>([]);
  const [tick, setTick] = useState(0);

  const queryKey = JSON.stringify(query ?? {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: query is serialized to queryKey; path is a stable callback identity by contract
  useEffect(() => {
    if (!ws || !key) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const cursor = depth > 0 ? cursorStack.current[depth - 1] : undefined;
    api<Page<T>>(path(ws), {
      apiKey: key,
      query: { ...query, cursor },
      signal: controller.signal,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items ?? []);
        setNext(page.next ?? null);
      })
      .catch((err: unknown) => {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === "AbortError")
        )
          return;
        setItems([]);
        setNext(null);
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, key, queryKey, depth, tick]);

  const reload = useCallback(() => {
    cursorStack.current = [];
    setDepth(0);
    setTick((t) => t + 1);
  }, []);

  const goNext = useCallback(() => {
    if (!next) return;
    cursorStack.current[depth] = next;
    setDepth((d) => d + 1);
  }, [next, depth]);

  const goPrev = useCallback(() => {
    setDepth((d) => Math.max(0, d - 1));
  }, []);

  return {
    items,
    next,
    loading,
    error,
    reload,
    goNext,
    goPrev,
    pageDepth: depth,
    canGoPrev: depth > 0,
  };
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "NETWORK_ERROR";
}
