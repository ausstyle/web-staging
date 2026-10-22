/** Pinned GitHub GraphQL documents. Operation arguments can supply only variables. */
const repository = `id nameWithOwner owner { login __typename }`;
const discussion =
  `id number title bodyText url createdAt updatedAt closed locked isAnswered category { id slug } author { login } answer { id } repository { nameWithOwner }`;
const comment =
  `id bodyText createdAt updatedAt isAnswer author { login } replyTo { id } discussion { number repository { nameWithOwner } }`;
const pageInfo = `pageInfo { hasNextPage endCursor }`;
export const fixedGraphQLDocuments = Object.freeze({
  repository:
    `query SandyBoundRepository { repository(owner:"ausstyle", name:"web-staging") { ${repository} } }`,
  categories:
    `query SandyDiscussionCategories($first:Int!, $after:String) { repository(owner:"ausstyle",name:"web-staging") { ${repository} discussionCategories(first:$first,after:$after) { nodes { id slug name isAnswerable } ${pageInfo} } } }`,
  list:
    `query SandyDiscussions($first:Int!, $after:String) { repository(owner:"ausstyle",name:"web-staging") { ${repository} discussions(first:$first,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${discussion} } ${pageInfo} } } }`,
  discussion:
    `query SandyDiscussion($number:Int!) { repository(owner:"ausstyle",name:"web-staging") { ${repository} discussion(number:$number) { ${discussion} } } }`,
  comments:
    `query SandyDiscussionComments($number:Int!,$first:Int!,$after:String) { repository(owner:"ausstyle",name:"web-staging") { ${repository} discussion(number:$number) { id number repository { nameWithOwner } comments(first:$first,after:$after) { nodes { ${comment} } ${pageInfo} } } } }`,
  comment:
    `query SandyDiscussionComment($id:ID!) { node(id:$id) { __typename ... on DiscussionComment { ${comment} } } }`,
  replies:
    `query SandyDiscussionReplies($id:ID!,$first:Int!,$after:String) { node(id:$id) { __typename ... on DiscussionComment { ${comment} replies(first:$first,after:$after) { nodes { ${comment} } ${pageInfo} } } } }`,
  create:
    `mutation SandyCreateDiscussion($input:CreateDiscussionInput!) { createDiscussion(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  update:
    `mutation SandyUpdateDiscussion($input:UpdateDiscussionInput!) { updateDiscussion(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  delete:
    `mutation SandyDeleteDiscussion($input:DeleteDiscussionInput!) { deleteDiscussion(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  close:
    `mutation SandyCloseDiscussion($input:CloseDiscussionInput!) { closeDiscussion(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  reopen:
    `mutation SandyReopenDiscussion($input:ReopenDiscussionInput!) { reopenDiscussion(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  comment_create:
    `mutation SandyAddDiscussionComment($input:AddDiscussionCommentInput!) { addDiscussionComment(input:$input) { clientMutationId comment { id discussion { number repository { nameWithOwner } } } } }`,
  comment_update:
    `mutation SandyUpdateDiscussionComment($input:UpdateDiscussionCommentInput!) { updateDiscussionComment(input:$input) { clientMutationId comment { id discussion { number repository { nameWithOwner } } } } }`,
  comment_delete:
    `mutation SandyDeleteDiscussionComment($input:DeleteDiscussionCommentInput!) { deleteDiscussionComment(input:$input) { clientMutationId comment { id discussion { number repository { nameWithOwner } } } } }`,
  comment_mark_answer:
    `mutation SandyMarkDiscussionCommentAsAnswer($input:MarkDiscussionCommentAsAnswerInput!) { markDiscussionCommentAsAnswer(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
  comment_unmark_answer:
    `mutation SandyUnmarkDiscussionCommentAsAnswer($input:UnmarkDiscussionCommentAsAnswerInput!) { unmarkDiscussionCommentAsAnswer(input:$input) { clientMutationId discussion { id number repository { nameWithOwner } } } }`,
});
export const graphMutationFields: Record<string, string> = {
  discussion_create: "createDiscussion",
  discussion_update: "updateDiscussion",
  discussion_delete: "deleteDiscussion",
  discussion_close: "closeDiscussion",
  discussion_reopen: "reopenDiscussion",
  comment_create: "addDiscussionComment",
  comment_update: "updateDiscussionComment",
  comment_delete: "deleteDiscussionComment",
  comment_mark_answer: "markDiscussionCommentAsAnswer",
  comment_unmark_answer: "unmarkDiscussionCommentAsAnswer",
};
