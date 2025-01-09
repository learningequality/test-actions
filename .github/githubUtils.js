const GithubAPI = require('./GithubAPI');

const synchronizeProjectsStatuses = async (context, github) => {
  const sourceNumber = 15; //"Iteration backlog";
  const targetNumber = 29; // KDS Roadmap
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

module.exports = {
  synchronizeProjectsStatuses
};
