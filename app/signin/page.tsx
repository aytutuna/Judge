import type { Metadata } from "next";
import { SignInView } from "@/components/account/SignInView";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Judge with Apple, Google or an email link to get a verdict.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { next } = await searchParams;
  return <SignInView next={next} />;
}
