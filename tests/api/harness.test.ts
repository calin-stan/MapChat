import { describe, expect, it } from "vitest";

import { apiRequest, connect, routeParams, serviceClient, truncateAll } from "./helpers";

describe("api test harness", () => {
  it("populates the server configuration from the local stack", () => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^https?:\/\//);
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });

  it("reaches the database through the service-role client", async () => {
    const { data, error } = await serviceClient().from("chatrooms").select("id").limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("shares the truncation helper with the database tests", async () => {
    const sql = connect();
    try {
      await truncateAll(sql);
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.chatrooms`;
      expect(row.count).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("builds handler requests and params", async () => {
    const post = apiRequest("/api/rooms", { method: "POST", body: { a: 1 } });
    expect(post.method).toBe("POST");
    expect(new URL(post.url).pathname).toBe("/api/rooms");
    expect(post.headers.get("content-type")).toBe("application/json");
    await expect(post.json()).resolves.toEqual({ a: 1 });

    const raw = apiRequest("/api/rooms", { method: "POST", body: "{not json" });
    await expect(raw.text()).resolves.toBe("{not json");

    const get = apiRequest("/api/rooms?bbox=-1,-2,3,4");
    expect(get.method).toBe("GET");
    expect(new URL(get.url).searchParams.get("bbox")).toBe("-1,-2,3,4");

    await expect(routeParams("x").params).resolves.toEqual({ id: "x" });
  });
});
