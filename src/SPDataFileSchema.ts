export type ProjectItemType =
  "Microsoft.VisualStudio.SharePoint.VisualWebPart" |
  "Microsoft.VisualStudio.SharePoint.Module" |
  "Microsoft.VisualStudio.SharePoint.MappedFolder";

export type ProjectItemFileType =
  "ElementManifest" |
  "ElementFile" |
  "TemplateFile";

export type ProjectItem = {
  $: {
    Type: ProjectItemType
  },
  Files?: { ProjectItemFile?: ProjectItemFile[] }[]
  ProjectItemFolder?: ProjectItemFolder[]
}

export type ProjectItemFolder = {
  $: {
    Target: string,
    Type: "TemplateFile" | "RootFile"
  }
}

export type ProjectItemFile = {
  $: {
    Source: string,
    Target: string,
    Type: ProjectItemFileType
  }
}

export type SPDataFile = {
  ProjectItem: ProjectItem
}