import { beforeEach, describe, expect, test } from "vitest";
import { useSelection } from "./selection";

const PLANE = { kind: "entity", id: "a", moduleId: "aircraft" } as const;
const OTHER = { kind: "entity", id: "b", moduleId: "aircraft" } as const;
const QUAKE = { kind: "event", id: "q", moduleId: "earthquakes" } as const;

beforeEach(() => {
  useSelection.setState({ selected: null, focus: null, following: false });
});

describe("following", () => {
  test("starts off and toggles for a selected entity", () => {
    const { select, toggleFollow } = useSelection.getState();
    expect(useSelection.getState().following).toBe(false);
    select(PLANE);
    toggleFollow();
    expect(useSelection.getState().following).toBe(true);
    toggleFollow();
    expect(useSelection.getState().following).toBe(false);
  });

  test("cannot be turned on with nothing or an event selected", () => {
    const { select, toggleFollow } = useSelection.getState();
    toggleFollow();
    expect(useSelection.getState().following).toBe(false);
    select(QUAKE);
    toggleFollow();
    expect(useSelection.getState().following).toBe(false);
  });

  test("stops when something else is selected or the selection clears", () => {
    const { select, toggleFollow } = useSelection.getState();
    select(PLANE);
    toggleFollow();
    select(OTHER);
    expect(useSelection.getState().following).toBe(false);
    toggleFollow();
    select(null);
    expect(useSelection.getState().following).toBe(false);
  });

  test("selecting the same entity again keeps following", () => {
    const { select, toggleFollow } = useSelection.getState();
    select(PLANE);
    toggleFollow();
    select({ ...PLANE });
    expect(useSelection.getState().following).toBe(true);
  });

  test("stops when the globe is told to centre somewhere", () => {
    const { select, toggleFollow, focusOn } = useSelection.getState();
    select(PLANE);
    toggleFollow();
    focusOn({ lat: 1, lon: 2 });
    expect(useSelection.getState().following).toBe(false);
    expect(useSelection.getState().focus?.nonce).toBe(1);
  });

  test("stopping when not following changes nothing", () => {
    const before = useSelection.getState();
    useSelection.getState().stopFollowing();
    expect(useSelection.getState()).toBe(before);
  });

  test("stopFollowing turns it off", () => {
    const { select, toggleFollow, stopFollowing } = useSelection.getState();
    select(PLANE);
    toggleFollow();
    stopFollowing();
    expect(useSelection.getState().following).toBe(false);
  });
});
