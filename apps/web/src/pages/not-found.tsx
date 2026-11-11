import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to products</Link>
      </Button>
    </div>
  );
}
