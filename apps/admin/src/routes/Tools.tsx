import SeedLibrary from "../SeedLibrary";
import RecipeBackfill from "../RecipeBackfill";

// Operational utilities, clearly separated from the management sections
// (own "tools" nav group — see nav-config.ts).
export default function Tools({ session }: { session: any }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Tools</h2>
        <p className="text-sm text-muted-foreground">Operational utilities — batch recipe generation and library maintenance.</p>
      </div>
      <SeedLibrary session={session} />
      <RecipeBackfill session={session} />
    </div>
  );
}
