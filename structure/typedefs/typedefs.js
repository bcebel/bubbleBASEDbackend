import { gql } from "graphql-tag";

const typeDefs = gql`
  type User {
    id: ID!
    username: String!
    email: String!
    bio: String
    affiliateLinks: [AffiliateLink!]!
    youtubeChannel: String
    profilePhoto: String
    videos: [Video!]
    streams: [Stream!]
    chats: [Chat!] # Chats the user is involved in
    posts: [Post!] # Posts the user has created
    groups: [Group!] # Groups the user is part of
    createdAt: String!
    updatedAt: String!
    joinedViaLink: [JoinedViaLink!]
  }

  type Image {
    id: ID!
    title: String!
    description: String
    user: User!
    neighborhood: Neighborhood
    fileName: String!
    fileSize: Int!
    fileType: String!
    mimetype: String!
    cid: String!
    ipfsUrl: String!
    thumbnailUrl: String
    magnetLink: String!
    strategy: String
    isPublic: Boolean!
    createdAt: String!
  }

  type AffiliateLink {
    id: ID!
    url: String!
    imageUrl: String!
    title: String
    description: String
    clicks: Int
  }

  type Neighborhood {
    id: ID!
    name: String!
    description: String
    type: String!
    bubblePhotoCid: String
    owner: User!
    members: [NeighborhoodMember]
    joinRequests: [JoinRequest]
    rules: String
    createdAt: String!
    updatedAt: String!
    memberCount: Int!

    inviteLinks: [InviteLink!]!
  }

  type NeighborhoodMember {
    user: User!
    role: String!
    joinedAt: String!
  }

  type JoinRequest {
    user: User!
    requestedAt: String!
    status: String!
  }

  type IPFSData {
    cid: String
    ipfsUrl: String
    magnetLink: String
    fileType: String
    fileName: String
  }
  type Chat {
    id: ID!
    name: String!
    participants: [User!]!
    messages: [Message!]!
    createdAt: String!
    updatedAt: String!
  }
  input IPFSDataInput {
    cid: String
    ipfsUrl: String
    magnetLink: String
    fileType: String
    fileName: String
  }
  input AffiliateLinkInput {
    url: String!
    title: String
    description: String
  }
  input MessageInput {
    content: String!
    room: String!
    imageUrl: String
    videoUrl: String
    fileUrl: String
    fileName: String
    fileType: String
    fileSize: Float
    magnetLink: String
    mimeType: String
    ipfsHash: String
    ipfsData: IPFSDataInput
    sessionId: String
    chunkIndex: Int
    totalChunks: Int
    neighborhoodId: ID
  }

  type Message {
    id: ID!
    sender: User!
    content: String!
    imageUrl: String
    videoUrl: String
    fileUrl: String
    fileName: String
    fileType: String
    fileSize: Float # Keep as Float in GraphQL
    magnetLink: String
    mimeType: String
    cid: String
    ipfsUrl: String
    ipfsHash: String
    ipfsData: IPFSData
    thumbnailUrl: String
    rotation: Int
    room: String!
    neighborhood: Neighborhood
    sessionId: String
    chunkIndex: Int
    totalChunks: Int
    createdAt: String!
  }

  input MediaInput {
    url: String
    cid: String
    magnetLink: String
    mediaType: String # "image", "video", "audio", "file"
  }

  input CreatePostInput {
    content: String!
    feedType: String # "universal", "neighborhood", "group", "individual"
    neighborhoodId: ID
    groupId: ID
    media: [MediaInput]
    affiliateHtml: String # Raw HTML snippet pasted from CJ, Impact, Awin, etc.
    affiliateUrl: String # Direct target URL if pasted without HTML
  }

  type AffiliateData {
    targetUrl: String
    bannerUrl: String
    title: String
    network: String
    rawHtml: String
    isSponsored: Boolean
  }

  type PostMedia {
    url: String
    cid: String
    magnetLink: String
    mediaType: String
  }

  type Post {
    id: ID!
    content: String
    author: User!
    media: [PostMedia]
    affiliate: AffiliateData
    feedType: String!
    neighborhood: Neighborhood!
    group: Group
    likes: [User]
    comments: [Comment!]!
    isPinned: Boolean
    commentCount: Int!
    createdAt: String
    updatedAt: String
  }

  type Comment {
    id: ID!
    content: String!
    author: User!
    post: Post!
    createdAt: String!
  }

  type Group {
    id: ID!
    name: String!
    description: String!
    members: [User!]!
    posts: [Post!]!
    createdAt: String!
    updatedAt: String!
  }

  type Video {
    id: ID!
    title: String!
    description: String!
    youtubeVideoId: String!
    thumbnail: String
    fileName: String!
    fileSize: Int!
    fileType: String!
    cid: String!
    ipfsUrl: String!
    magnetLink: String!
    user: User!
    strategy: String
    neighborhood: Neighborhood
    isPublic: Boolean!
    createdAt: String!
  }

  type Stream {
    id: ID!
    sessionId: String!
    startedBy: User!
    neighborhood: Neighborhood!
    title: String
    archiveUrl: String
    isPermanentP2P: Boolean
    chunks: [StreamChunk!]!
    thumbnailUrl: String
    header: StreamChunk
    status: String!
    rotation: Int
    createdAt: String!
    updatedAt: String!
  }

  type StreamChunk {
    id: ID!
    sessionId: String!
    chunkIndex: Int!
    magnetLink: String!
    fileName: String!
    thumbnailUrl: String
    fileType: String
    fileSize: Int
    duration: Float
    mimeType: String
    rotation: Int
    trackerUrls: [String!]
  }

  type Ad {
    id: ID!
    affiliateLink: String!
    user: User!
    clicks: Int!
    createdAt: String!
  }

  type Query {
    myDirectMessageBubbles: [Neighborhood]
    streamBySessionId(sessionId: String!): Stream
    streamChunks(sessionId: String!): [StreamChunk]
    getMyAllNeighborhoodsGallery: GalleryResponse
    comments(postId: ID!): [Comment!]!
    # User queries
    users: [User!]
    user(id: ID!): User
    me: User
    userByUsername(username: String!): User

    # Video queries
    videos: [Video!]
    video(id: ID!): Video

    getNeighborhoodVideos(neighborhoodId: ID!): [Video]
    getNeighborhoodImages(neighborhoodId: ID!): [Image]
    getNeighborhoodGallery(neighborhoodId: ID!): GalleryResponse

    # Stream queries
    streams(status: String): [Stream!]!
    stream(id: ID!): Stream

    # Ad queries
    ads: [Ad!]
    ad(id: ID!): Ad

    randomAffiliateLink: AffiliateLink

    # Chat queries
    chats: [Chat!]
    chat(id: ID!): Chat

    # Message queries
    messages(neighborhood: ID!, room: String): [Message!]!
    message(id: ID!): Message

    # Post queries
    posts(neighborhoodId: ID, limit: Int, offset: Int): [Post!]!
    post(id: ID!): Post

    # Group queries
    groups: [Group!]
    group(id: ID!): Group

    neighborhoodMessages(neighborhoodId: ID!): [Message]
    neighborhoodVideos(neighborhoodId: ID!): [Video]

    publicVideos: [Video]
    publicImages: [Image]
    myVideos: [Video]

    getMyVideos: [Video]
    getUserVideos(userId: ID!): [Video]

    neighborhoods: [Neighborhood]
    neighborhood(id: ID!): Neighborhood
    myNeighborhoods: [Neighborhood]
    discoverNeighborhoods: [Neighborhood] # Public neighborhoods to discover
    images: [Image!]!
    image(id: ID!): Image
    neighborhoodImages(neighborhoodId: ID!): [Image!]!
    myImages: [Image!]!
    validateInviteLink(code: String!): InviteLinkValidation!

    neighborhoodInviteLinks(neighborhoodId: ID!): [InviteLink!]
  }

  type GalleryResponse {
    videos: [Video]
    images: [Image]
    totalCount: Int
  }

  type Subscription {
    messageAdded(room: String!): Message
    postAdded(feedType: String, groupId: ID): Post
    livestreamChunkAdded(sessionId: String!): StreamChunk
  }

  type Mutation {
    updateBubblePhoto(neighborhoodId: ID!, cid: String!): Neighborhood
    createDirectMessageBubble(userId: ID!): Neighborhood
    acceptBubbleInvite(directMessageBubbleId: ID!, sourceBubbleId: ID!): Boolean
    addComment(postId: ID!, content: String!): Comment!
    completeStream(
      sessionId: String!
      archiveUrl: String
      totalChunks: Int
    ): Stream
    # Auth mutations
    registerUser(
      username: String!
      email: String!
      password: String!
    ): AuthPayload!
    loginUser(username: String!, password: String!): AuthPayload!
    # Create a new invite link
    createInviteLink(
      neighborhoodId: ID!
      name: String
      maxUses: Int
      expiresInDays: Int
      role: String
    ): InviteLink!
    toggleVideoPrivacy(videoId: ID!): Video
    createVideo(input: VideoInput!): Video

    # Update an invite link
    updateInviteLink(
      linkId: ID!
      name: String
      maxUses: Int
      expiresAt: String
      isActive: Boolean
    ): InviteLink!

    # Delete an invite link
    deleteInviteLink(linkId: ID!): Boolean!

    # Join a neighborhood via invite link (public mutation - no auth required)
    joinViaInviteLink(code: String!): JoinViaLinkResult!

    # Create account and join via link in one step
    registerAndJoinViaLink(
      code: String!
      username: String!
      email: String!
      password: String!
    ): AuthPayload!

    updateProfile(
      bio: String
      profilePhoto: String
      affiliateLinks: [AffiliateLinkInput]
    ): User!

    # Affiliate mutations
    addAffiliateLink(url: String!, title: String, description: String): User!
    updateAffiliateLink(
      linkId: ID!
      url: String
      title: String
      description: String
    ): User!
    removeAffiliateLink(linkId: ID!): User!

    # Video mutations
    addVideo(
      title: String!
      description: String!
      youtubeVideoId: String!
      thumbnail: String
    ): Video!

    # Stream mutations
    addStream(
      title: String!
      description: String!
      youtubeStreamId: String!
      isLive: Boolean!
    ): Stream!
    createStream(title: String!, neighborhoodId: ID!): Stream

    # Ad mutations
    addAd(affiliateLink: String!): Ad!
    incrementAdClicks(adId: ID!): Ad!

    # Chat mutations
    createChat(name: String!, participantIds: [ID!]!): Chat!
    joinChat(chatId: ID!): Chat!
    leaveChat(chatId: ID!): Boolean!

    # Message mutations
    sendMessage(
      content: String!
      room: String!
      imageUrl: String
      videoUrl: String
      fileUrl: String
      fileName: String
      fileType: String
      magnetLink: String
      fileSize: Float
      mimeType: String
      ipfsHash: String
      ipfsData: IPFSDataInput
      cid: String
      rotation: Int
      thumbnailUrl: String
      ipfsUrl: String
      sessionId: String
      chunkIndex: Int
      totalChunks: Int
      neighborhoodId: ID
    ): Message!
  }

  type Mutation {
    createPost(input: CreatePostInput!): Post!

    # Group mutations
    createGroup(name: String!, description: String!): Group!
    joinGroup(groupId: ID!): Group!
    leaveGroup(groupId: ID!): Group!

    deletePost(postId: ID!): Boolean
    deleteMessage(messageId: ID!): Boolean
    createNeighborhood(
      name: String!
      description: String
      type: String
    ): Neighborhood
    updateNeighborhood(
      id: ID!
      name: String
      description: String
      rules: String
    ): Neighborhood
    deleteNeighborhood(neighborhoodId: ID!): Boolean
    attachMagnet(id: ID!, magnetLink: String!): Video
    joinNeighborhood(neighborhoodId: ID!): Neighborhood
    leaveNeighborhood(neighborhoodId: ID!): Boolean

    # For neighborhood owners/moderators
    approveJoinRequest(neighborhoodId: ID!, userId: ID!): Neighborhood
    rejectJoinRequest(neighborhoodId: ID!, userId: ID!): Neighborhood
    removeMember(neighborhoodId: ID!, userId: ID!): Neighborhood

    # Invite system (optional for later)
    inviteToNeighborhood(neighborhoodId: ID!, username: String!): Boolean

    sendImage(
      neighborhoodId: ID
      title: String
      description: String
      fileName: String!
      fileSize: Int!
      fileType: String!
      mimetype: String!
      cid: String!
      ipfsUrl: String!
      magnetLink: String!
    ): Image!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  input VideoInput {
    title: String
    description: String
    fileName: String!
    fileSize: Int
    fileType: String!
    cid: String!
    magnetLink: String
    isPublic: Boolean
    neighborhoodId: ID
  }

  type InviteLink {
    id: ID!
    code: String!
    name: String!
    createdBy: User!
    maxUses: Int!
    uses: Int!
    expiresAt: String
    role: String!
    isActive: Boolean!
    createdAt: String!
    url: String! # Computed field
  }

  type JoinViaLinkResult {
    success: Boolean!
    message: String!
    neighborhood: Neighborhood
    error: String
  }

  type JoinedViaLink {
    neighborhood: Neighborhood!
    linkCode: String!
    joinedAt: String!
  }

  type InviteLinkValidation {
    isValid: Boolean!
    message: String!
    link: InviteLink
    neighborhood: Neighborhood
  }
`;

export default typeDefs;
