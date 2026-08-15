import { Workbench } from "./workbench"

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <Workbench guest project={{ id: projectId, title: "" }} />
}
