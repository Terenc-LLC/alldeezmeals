import UsersDirectory from "../UsersDirectory";

// UsersDirectory renders its own heading (with a live filtered count), unlike
// ApprovalsPage's static title — no need to duplicate it here.
export default function Users({ session }: { session: any }) {
  return <UsersDirectory session={session} />;
}
