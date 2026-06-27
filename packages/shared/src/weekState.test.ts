import { describe, it, expect } from "vitest";
import { addDays, shouldApplyRemoteState } from "./weekState";

describe("addDays", () => {
  it("adds within a month", () => expect(addDays("2026-06-10", 3)).toBe("2026-06-13"));
  it("rolls over month boundaries", () => expect(addDays("2026-06-29", 3)).toBe("2026-07-02"));
  it("rolls over year boundaries", () => expect(addDays("2026-12-30", 7)).toBe("2027-01-06"));
  it("steps a full week in both directions (Plan week navigation)", () => {
    expect(addDays("2026-06-15", 7)).toBe("2026-06-22");
    expect(addDays("2026-06-15", -7)).toBe("2026-06-08");
  });
});

describe("shouldApplyRemoteState", () => {
  const u = "user-1";
  const base = { localSavedAt: "2026-06-12T10:00:00.000Z", localSavedBy: u, userId: u };

  it("applies remote when it is strictly newer than local", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: "2026-06-12T10:00:01.000Z" })).toBe(true);
  });
  it("keeps local when remote is older (the reload-clobber bug)", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: "2026-06-12T09:59:59.000Z" })).toBe(false);
  });
  it("keeps local when stamps are equal (flush completed; contents identical)", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: base.localSavedAt })).toBe(false);
  });
  it("applies remote when local blob is unstamped (pre-fix blob or fresh device)", () => {
    expect(shouldApplyRemoteState({ localSavedAt: null, localSavedBy: null, remoteStamp: null, userId: u })).toBe(true);
  });
  it("applies remote when local blob belongs to a different user (shared device)", () => {
    expect(shouldApplyRemoteState({ ...base, localSavedBy: "user-2", remoteStamp: "2026-06-11T00:00:00.000Z" })).toBe(true);
  });
  it("keeps same-user local when remote has no stamp at all", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: null })).toBe(false);
  });
});
