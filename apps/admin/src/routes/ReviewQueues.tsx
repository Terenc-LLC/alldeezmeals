import RecipeReviewQueue from "../RecipeReviewQueue";
import SubmissionReviewQueue from "../SubmissionReviewQueue";

export default function ReviewQueues({ session }: { session: any }) {
  return (
    <div className="flex flex-col gap-8">
      <RecipeReviewQueue session={session} />
      <SubmissionReviewQueue session={session} />
    </div>
  );
}
