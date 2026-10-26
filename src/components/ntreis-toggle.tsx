"use client";

import { useEffect, useState } from "react";

// On Add a home: show the NTREIS questions only when the home is going to
// NTREIS (picked MLS, else the builder's locked MLS, else the community's).
// Hidden questions are disabled too, so they don't save anything.
export function NtreisToggle({
  formId,
  communityBoards,
  lockedBoard,
}: {
  formId: string;
  communityBoards: Record<string, string | null>;
  lockedBoard: string | null;
}) {
  const [board, setBoard] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const update = () => {
      const community = (form.elements.namedItem("community_id") as HTMLSelectElement | null)?.value ?? "";
      const picked = (form.elements.namedItem("mls_board") as HTMLSelectElement | null)?.value ?? "";
      const b = picked || lockedBoard || communityBoards[community] || null;
      // Until we know the MLS, show the NTREIS questions (most homes go there).
      const ntreis = b === null || b === "NTREIS";
      form.querySelectorAll<HTMLFieldSetElement>("fieldset[data-ntreis]").forEach((el) => {
        el.hidden = !ntreis;
        el.disabled = !ntreis;
      });
      // Steps made only of NTREIS questions are skipped for other MLSs (FormSteps listens).
      if (form.dataset.ntreis !== (ntreis ? "1" : "0")) {
        form.dataset.ntreis = ntreis ? "1" : "0";
        form.dispatchEvent(new CustomEvent("ntreis-change"));
      }
      form.querySelectorAll<HTMLElement>("[data-other-mls]").forEach((el) => {
        el.hidden = ntreis;
        el.querySelectorAll<HTMLInputElement>("input, select").forEach((i) => (i.disabled = ntreis));
      });
      setBoard(b);
    };
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, [formId, communityBoards, lockedBoard]);

  if (board === undefined) return null;
  return board === null || board === "NTREIS" ? (
    <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">
      {board === null ? "Most homes go to NTREIS, so its questions are below. " : "This home goes to NTREIS (North Texas), so its questions are below. "}
      Labels and choices match NTREIS’s own form. Questions marked <b className="text-accent">MLS required</b> are shaded blue until answered; NTREIS needs them before the listing goes live, but you can save a draft without them.
    </p>
  ) : (
    <p className="rounded-xl bg-soft px-4 py-3 text-sm">This home goes to {board}, so only the basic details are asked here. Our team fills in the rest.</p>
  );
}
