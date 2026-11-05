import { Anchor, FileClock, GitBranch, ShieldCheck } from "lucide-react"
import { APP_NAME } from "@/lib/config"

const HIGHLIGHTS = [
  { icon: FileClock, text: "Every version kept, with owner and timestamp" },
  { icon: GitBranch, text: "Access follows your department hierarchy" },
  { icon: ShieldCheck, text: "Review and approval before documents go live" },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/15">
            <Anchor className="size-5" />
          </span>
          {APP_NAME}
        </div>
        <div className="max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight">
            Every document in one place — traceable from first draft to approval.
          </h2>
          <ul className="space-y-3 text-primary-foreground/85">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-5 shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/60">Academic · HR · Student Records · Quality &amp; Compliance</p>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 font-semibold lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Anchor className="size-4" />
            </span>
            {APP_NAME}
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
