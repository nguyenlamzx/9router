import { NextResponse } from "next/server";
import { getCombos, getComboById, updateCombo } from "@/lib/localDb";
import { scoreCombo } from "@/lib/comboScoring";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const comboIds = Array.isArray(body.comboIds) ? body.comboIds : [];
    const dryRun = body.dryRun === true;

    const combos = comboIds.length > 0
      ? (await Promise.all(comboIds.map((id) => getComboById(id)))).filter(Boolean)
      : await getCombos();

    const results = [];
    let updated = 0;
    let skipped = 0;

    for (const combo of combos) {
      if (!Array.isArray(combo.models) || combo.models.length === 0) {
        skipped += 1;
        results.push({ id: combo.id, status: "skipped", reason: "NO_MODELS" });
        continue;
      }

      const score = await scoreCombo(combo.models, { timeout: 1000 });
      if (!score) {
        skipped += 1;
        results.push({ id: combo.id, status: "skipped", reason: "NO_SCORE" });
        continue;
      }

      const autoGroupMeta = {
        ...score,
        source: "batch-regroup",
      };

      if (!dryRun) {
        await updateCombo(combo.id, { autoGroupMeta });
      }

      updated += 1;
      results.push({
        id: combo.id,
        status: dryRun ? "preview" : "updated",
        profile: score.profile,
        score: score.score,
      });
    }

    return NextResponse.json({
      total: combos.length,
      processed: combos.length,
      updated,
      skipped,
      results,
    });
  } catch (error) {
    console.log("Error regrouping combos:", error);
    return NextResponse.json({ error: "Failed to regroup combos" }, { status: 500 });
  }
}
