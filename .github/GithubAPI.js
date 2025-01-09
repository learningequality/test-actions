module.exports = class GithubAPI {
  constructor(owner, github) {
    this.owner = owner;
    this.github = github;
  }

  async getSourceAndTargetProjects({ sourceNumber, targetNumber }) {
    const projectSubquery = `
      id
      title
      fields(first: 30) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    `;
    const query = `
      query getSourceAndTargetProjectsIds($owner: String!, $source: Int!, $target: Int!) {
        organization (login: $owner) {
          source: projectV2(number: $source) {
            ${projectSubquery}
          }
          target: projectV2(number: $target) {
            ${projectSubquery}
          }
        }
      }
    `;

    const response = await this.github.graphql(query, {
      owner: this.owner,
      source: sourceNumber,
      target: targetNumber,
    });

    const { source, target } = response.organization;

    if (!source) {
      throw new Error(`Source project not found: ${sourceNumber}`);
    }

    if (!target) {
      throw new Error(`Target project not found: ${targetNumber}`);
    }

    return {
      sourceProject: source,
      targetProject: target
    };
  }

  async getProjectItems(projectId) {
    const statusSubquery = `
      status: fieldValueByName(name: "Status") {
        ... on ProjectV2ItemFieldSingleSelectValue {
          vaueId: id
          value: name
          valueOptionId: optionId
        }
      }
    `;
    // Subquery to get info about the status of the issue/PR on each project it belongs to
    const projectItemsSubquery = `
      projectItems(first: 10) {
        nodes {
          id
          ${ statusSubquery }
          project {
            id
            title
          }
        }
      }
    `;
    const query = `
      query GetProjectItems($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                ${ statusSubquery }
                content {
                  __typename
                  ... on Issue {
                    id
                    title
                    url
                    ${ projectItemsSubquery }
                  }
                  ... on PullRequest {
                    id
                    title
                    url
                    ${ projectItemsSubquery }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const _getProjectItems = async (cursor = null, items = []) => {
      const response = await this.github.graphql(query, {
        projectId,
        cursor
      });

      const { nodes, pageInfo } = response.node.items;

      items.push(...nodes);

      if (pageInfo.hasNextPage) {
        return _getProjectItems(pageInfo.endCursor, items);
      }

      return items;
    };

    return _getProjectItems();
  }

  async updateProjectItemsFields(items) {
    const query = `
      mutation UpdateProjectItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $newValue: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: $newValue
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const BATCH_SIZE = 10;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(item => (
        this.github.graphql(query, {
          projectId: item.projectId,
          itemId: item.projectItemId,
          fieldId: item.fieldId,
          newValue: item.newValue
        })
      )));
    }
  }
}