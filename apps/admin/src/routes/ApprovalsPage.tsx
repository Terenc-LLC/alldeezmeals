import Approvals from "../Approvals";

export default function ApprovalsPage({ session }: { session: any }) {
  return (
    <>
      <h2 className="mb-4 text-base font-semibold text-foreground">Pending approvals</h2>
      <Approvals session={session} />
    </>
  );
}
