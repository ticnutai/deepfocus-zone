import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatePayload: null as Record<string, unknown> | null,
}));

vi.mock("@/components/admin/ChangeNotesTab", () => ({ ChangeNotesTab: () => null }));
vi.mock("@/lib/study/userQuestionsExport", () => ({ exportCardsDocument: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin-id" } } }) },
    rpc: async (name: string) => name === "get_admin_user_questions" ? ({
      data: [{
        id: "11111111-1111-1111-1111-111111111111",
        user_id: "22222222-2222-2222-2222-222222222222",
        created_by: "22222222-2222-2222-2222-222222222222",
        deck_id: null,
        type: "multiple",
        question: "שאלה ששויכה לעמוד",
        answer: null,
        options: ["א", "ב"],
        correct_indices: [0],
        correct_boolean: null,
        explanation: null,
        tags: ["source:desktop", "cat:ללא סיווג"],
        srs: {}, stats: {}, masechta: "שבת", daf: 2, amud: 1,
        moderation_status: "private", moderated_at: null, moderated_by: null,
        published_card_id: null, deleted_at: null,
        created_at: "2026-09-11T09:00:00.000Z", updated_at: "2026-09-11T09:00:00.000Z",
      }], error: null,
    }) : ({ data: null, error: null }),
    from: (table: string) => ({
      select: async () => table === "profiles" ? ({
        data: [{ id: "22222222-2222-2222-2222-222222222222", display_name: "משתמש אופליין שלי", username: "offline-abcdef1234567890", email: "offline-abcdef1234567890@users.local" }], error: null,
      }) : ({ data: [{ user_id: "22222222-2222-2222-2222-222222222222", local_username: "offline-abcdef1234567890", display_name: "משתמש אופליין שלי" }], error: null }),
      update: (payload: Record<string, unknown>) => {
        mocks.updatePayload = payload;
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));

import { UserQuestionsTab } from "@/components/admin/UserQuestionsTab";

describe("user question moderation UI", () => {
  beforeEach(() => {
    mocks.updatePayload = null;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("hides technical identity and lets the admin change the submitted page before approval", async () => {
    render(<UserQuestionsTab />);

    expect(await screen.findByText("שאלה ששויכה לעמוד")).toBeInTheDocument();
    expect(screen.getByTestId("question-author-identity")).toHaveTextContent("משתמש אופליין שלי");
    expect(screen.getByTestId("question-author-identity")).not.toHaveTextContent("offline-");
    expect(screen.getByText("שבת · דף ב · עמוד א׳")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("עריכה"));
    expect(await screen.findByText("עריכת שאלה וסיווג")).toBeInTheDocument();
    expect(screen.getByTestId("moderation-masechta")).toHaveTextContent("שבת");

    fireEvent.click(screen.getByTestId("moderation-amud"));
    fireEvent.click(await screen.findByRole("option", { name: "עמוד ב׳" }));
    fireEvent.click(screen.getByRole("button", { name: "שמור וסמן כנבדקה" }));

    await waitFor(() => expect(mocks.updatePayload).toMatchObject({
      masechta: "שבת", daf: 2, amud: 2,
    }));
    expect(mocks.updatePayload?.tags).toEqual([
      "source:desktop", 'cat:ש"ס', "cat:מועד", "cat:שבת", "cat:שבת · ב.", 'cat:שבת · ב. · ע"ב',
    ]);
  });
});
