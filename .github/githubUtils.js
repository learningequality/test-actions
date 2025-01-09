const GithubAPI = require('./GithubAPI');

const ITERATION_BACKLOG_PROJECT_NUMBER = 15;
const KDS_ROADMAP_PROJECT_NUMBER = 29;

const synchronizeProjectsStatuses = async (context, github) => {
  const sourceNumber = ITERATION_BACKLOG_PROJECT_NUMBER;
  const targetNumber = KDS_ROADMAP_PROJECT_NUMBER;
  const getTargetStatus = (sourceStatus) => {
    const statusMap = {
      "IN REVIEW": "IN REVIEW",
      "IN PROGRESS": "IN PROGRESS",
      "NEEDS QA": "IN REVIEW",
      "DONE": "DONE",
      // All other statuses are mapped to "BACKLOG"
    };

    const targetStatus = Object.keys(statusMap).find((key) =>
      sourceStatus.toUpperCase().includes(key)
    );

    return targetStatus ? statusMap[targetStatus] : "BACKLOG";
  }

  const githubAPI = new GithubAPI(context.repo.owner, github);
  const { sourceProject, targetProject } = await githubAPI.getSourceAndTargetProjects({ sourceNumber, targetNumber });

  const targetStatusField = targetProject.fields.nodes.find((field) => field.name === "Status");

  const targetProjectItems = await githubAPI.getProjectItems(targetProject.id);
  const itemsToUpdate = targetProjectItems.filter((item) => {
    const statusToByPass = "RELEASED";
    const currentTargetStatusName = item.status?.value;
    if (currentTargetStatusName?.toUpperCase().includes(statusToByPass)) {
      return false;
    }

    const sourceProjectItem = item.content.projectItems?.nodes.find((sourceItem) => (
      sourceItem.project.id === sourceProject.id
    ));
    const sourceStatus = sourceProjectItem?.status?.value;
    if (!sourceStatus) {
      return false;
    }

    const newTargetStatus = getTargetStatus(sourceStatus);
    const newTargetStatusId = targetStatusField.options.find((option) => option.name.toUpperCase().includes(newTargetStatus))?.id;

    if (!newTargetStatusId) {
      return false;
    }

    item.newStatusId = newTargetStatusId;

    const currentTargetStatusId = item.status?.valueOptionId;
    return newTargetStatusId !== currentTargetStatusId;
  });

  if (itemsToUpdate.length === 0) {
    return;
  }

  const itemsPayload = itemsToUpdate.map(item => ({
    projectId: targetProject.id,
    projectItemId: item.id,
    fieldId: targetStatusField.id,
    newValue: {
      singleSelectOptionId: item.newStatusId
    },
    url: item.content.url
  }))

  await githubAPI.updateProjectItemsFields(itemsPayload);
  console.log(`${itemsToUpdate.length} items updated: `, itemsPayload.map(item => item.url));
}

const extractPullRequestNumbers = (releaseBody, owner) => {
  const prRegex = new RegExp(`github\\.com/${owner}/[a-zA-Z0-9-_]+/pull/(\\d+)`, "g");
  const prNumbers = [];
  let match;
  while ((match = prRegex.exec(releaseBody)) !== null) {
    prNumbers.push(parseInt(match[1]));
  }

  const uniquePrNumbers = [...new Set(prNumbers)];
  return uniquePrNumbers;
};

const updateReleasedItemsStatuses = async (context, github) => {
  const body = context.payload.release.body;
  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  const release = context.payload.release.name;
  const prNumbers = extractPullRequestNumbers(body, owner);

  if (prNumbers.length === 0) {
    console.log("No PRs found in release body");
    return;
  }

  const githubAPI = new GithubAPI(owner, github);
  const prs = await githubAPI.getPRsWithLinkedIssues(prNumbers, repo);
  const project = await githubAPI.getProject(KDS_ROADMAP_PROJECT_NUMBER); 

  const contentItemsToAddToProject = [];
  const projectItemsToUpdate = [];

  prs.forEach((pr) => {
    const closingIssues = pr.closingIssuesReferences.nodes;
    if (closingIssues.length === 0) {
      const prProjectItems = pr.projectItems.nodes;
      const projectItem = prProjectItems.find((item) => item.project.id === project.id);
      if (!projectItem) {
        contentItemsToAddToProject.push({
          contentId: pr.id,
        });
        return;
      }
      projectItemsToUpdate.push(projectItem);
      return;
    }

    closingIssues.forEach((issue) => {
      const issueProjectItems = issue.projectItems.nodes;
      const projectItem = issueProjectItems.find((item) => item.project.id === project.id);
      if (!projectItem) {
        contentItemsToAddToProject.push({
          contentId: issue.id,
        });
        return;
      }
      projectItemsToUpdate.push(projectItem);
    });
  });

  if (contentItemsToAddToProject.length > 0) {
    await Promise.all(contentItemsToAddToProject.map(async ({ contentId }) => {
      const projectItemId = await githubAPI.addContentToProject(project.id, contentId);
      projectItemsToUpdate.push({ id: projectItemId });
    }));
  }

  const projectItemsChanges = [];

  if (projectItemsToUpdate.length > 0) {
    const releasedInFieldId = project.releasedIn.id;
    const statusFieldId = project.status.id;
    const statusReleasedOption = project.status.options.find((option) => option.name === "Released");
    const statusReleasedId = statusReleasedOption.id;

    projectItemsToUpdate.map(async (item) => {
      // Update "Released in" field with the release version
      const releasedIn = item.releasedIn?.text;
      const releasedInValue = releasedIn ? `${releasedIn},${release}` : release;
      projectItemsChanges.push({
        projectId: project.id,
        projectItemId: item.id,
        fieldId: releasedInFieldId,
        newValue: {
          text: releasedInValue,
        },
      });

      // Update status field to "Released"
      projectItemsChanges.push({
        projectId: project.id,
        projectItemId: item.id,
        fieldId: statusFieldId,
        newValue: {
          singleSelectOptionId: statusReleasedId,
        },
      });
    });
  }

  if (projectItemsChanges.length > 0) {
    await githubAPI.updateProjectItemsFields(projectItemsChanges);
  }
}


module.exports = {
  synchronizeProjectsStatuses,
  updateReleasedItemsStatuses,
};
