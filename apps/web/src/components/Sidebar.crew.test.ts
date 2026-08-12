import { describe, expect, it } from "vite-plus/test";

import { crewDeletePrompt, filterSidebarRootThreads, getCrewChildThreads } from "./Sidebar.logic";

const shell = (id: string, parentThreadId: string | null = null) => ({
  id,
  environmentId: "local",
  parentThreadId,
});

describe("crew threads in the sidebar", () => {
  it("hides linked children while their parent exists", () => {
    expect(filterSidebarRootThreads([shell("parent"), shell("child", "parent")])).toEqual([
      shell("parent"),
    ]);
  });

  it("keeps orphaned children out of the normal list", () => {
    expect(filterSidebarRootThreads([shell("child", "parent")])).toEqual([]);
  });

  it("counts direct children and uses the final delete prompt", () => {
    const threads = [shell("parent"), shell("one", "parent"), shell("two", "parent")];
    expect(getCrewChildThreads(threads, threads[0]!)).toHaveLength(2);
    expect(crewDeletePrompt(2)).toBe(
      "This thread dispatched work to 2 agents. Delete their threads too?",
    );
  });
});
