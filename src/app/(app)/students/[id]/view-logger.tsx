"use client"

import { useEffect } from "react"
import { logStudentView } from "../actions"

/** Records "viewed profile" in the audit log once per page view (not on prefetch). */
export function ViewLogger({ studentId }: { studentId: string }) {
  useEffect(() => {
    void logStudentView(studentId)
  }, [studentId])
  return null
}
