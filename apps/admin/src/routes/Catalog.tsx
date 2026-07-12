import CatalogDirectory from "../CatalogDirectory";

// CatalogDirectory renders its own heading (with a live filtered count), same
// pattern as Users.tsx — no need to duplicate it here.
export default function Catalog({ session }: { session: any }) {
  return <CatalogDirectory session={session} />;
}
