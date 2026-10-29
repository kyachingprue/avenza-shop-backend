const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const prisma = require("../src/db/prisma");

const postsPath = path.resolve(__dirname, "../../frontend/public/posts.json");
const postSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1)
}).passthrough();

async function importPosts() {
  const sourcePosts = JSON.parse(fs.readFileSync(postsPath, "utf8"));
  const posts = z.array(postSchema).parse(sourcePosts);
  if (new Set(posts.map(({ id }) => id)).size !== posts.length) {
    throw new Error("Posts data contains duplicate IDs");
  }
  if (new Set(posts.map(({ slug }) => slug)).size !== posts.length) {
    throw new Error("Posts data contains duplicate slugs");
  }

  for (const post of posts) {
    await prisma.catalogPost.upsert({
      where: { id: post.id },
      create: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        postData: post
      },
      update: {
        slug: post.slug,
        title: post.title,
        postData: post
      }
    });
  }

  const importedCount = await prisma.catalogPost.count();
  console.log(`Posts sync complete: ${posts.length} posts imported; ${importedCount} stored.`);
}

importPosts()
  .catch((error) => {
    console.error("Posts sync failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
