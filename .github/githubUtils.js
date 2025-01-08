const GithubAPI = require('./GithubAPI');

const synchronizeProjectsStatuses = async (github) => {
  const sourceNumber = 15; //"Iteration backlog";
  const targetNumber = 29; // KDS Roadmap
  const getTargetStatus = (sourceStatus) => {
    const statusMap = {
      "IN REVIEW": "IN REVIEW",
      "NEEDS QA": "IN REVIEW",
      "DONE": "DONE",
      // All other statuses are mapped to "BACKLOG"
    };

    const targetStatus = Object.keys(statusMap).find((key) => 
      sourceStatus.toUpperCase().includes(key)
    );

    return targetStatus ? statusMap[targetStatus] : "BACKLOG";
  }

  const githubAPI = new GithubAPI("LearningEquality", github);
  const { sourceProject, targetProject } = await githubAPI.getSourceAndTargetProjects({ sourceNumber, targetNumber });

  console.log("sourceName", sourceNumber);
  console.log("sourceProject", sourceProject);
  const targetStatusField = targetProject.fields.nodes.find((field) => field.name === "Status");

  const targetProjectItems = await githubAPI.getProjectItems(targetProject.id);
  const itemsToUpdate = targetProjectItems.filter((item) => {
    const sourceProjectItem = item.content.projectItems?.nodes.find((sourceItem) => (
      sourceItem.project.id === sourceProject.id
    ));
    if (!sourceProjectItem) {
      return false;
    }

    const sourceStatus = sourceProjectItem.status?.value;
    if (!sourceStatus) {
      return false;
    }

    const currentTargetStatusId = item.status?.valueOptionId;
    const newTargetStatus = getTargetStatus(sourceStatus);
    const newTargetStatusId = targetStatusField.options.find((option) => option.name.toUpperCase().includes(newTargetStatus))?.id;

    if (!newTargetStatusId) {
      console.log(`Status "${newTargetStatus}" not found in target project`);
      return false;
    }

    item.newStatusId = newTargetStatusId;

    return newTargetStatusId !== currentTargetStatusId;
  });

  if (itemsToUpdate.length === 0) {
    console.log("No items to update");
    return;
  }

  const itemsPayload = itemsToUpdate.map(item => ({
    projectId: targetProject.id,
    projectItemId: item.id,
    fieldId: targetStatusField.id,
    newValue: {
      singleSelectOptionId: item.newStatusId
    }
  }))

  console.log(`Updating ${itemsToUpdate.length} items...`);
  console.log("Items payload", itemsPayload);
  // await githubAPI.updateProjectItemsFields(itemsPayload);
  console.log("Items updated successfully");
}

module.exports = {
  synchronizeProjectsStatuses
};
