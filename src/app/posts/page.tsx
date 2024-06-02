import PostsList from "@/components/posts-list";
import { Suspense } from "react";


export const metadata: Metadata = {
  title: "Posts",
};

export default async function Posts() {

  return (
    <main className="text-center pt-16 px-5">
      <h1 className="text-3xl font-bold mb-5 md:text-4xl">All Posts</h1>
      
      <Suspense fallback={<div>Loading...</div>}>
        <PostsList />
        
        <p className="max-w-[750px] mx-auto leading-8">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Sequi, harum, et suscipit deleniti distinctio animi delectus hic explicabo rem deserunt, repellendus ad. Nesciunt incidunt tenetur dolores laborum voluptatibus, aperiam sed.</p>

      </Suspense>


    </main>
  );
}
