
export default function Home() {
  return (
    <main className="text-center px-5">
      <h1 className="text-3xl font-bold mb-5 md:text-4xl">RCaldas Web App</h1>


      <p className="max-w-[750px] mx-auto leading-8">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Sequi, harum, et suscipit deleniti distinctio animi delectus hic explicabo rem deserunt, repellendus ad. Nesciunt incidunt tenetur dolores laborum voluptatibus, aperiam sed.</p>


      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white shadow-lg p-5 rounded-lg">
          <h2 className="text-xl font-bold mb-3">Post 1</h2>
          <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Nesciunt, voluptates.</p>
        </div>
        <div className="bg-white shadow-lg p-5 rounded-lg">
          <h2 className="text-xl font-bold mb-3">Post 2</h2>
          <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Nesciunt, voluptates.</p>
        </div>
        <div className="bg-white shadow-lg p-5 rounded-lg">
          <h2 className="text-xl font-bold mb-3">Post 3</h2>
          <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Nesciunt, voluptates.</p>
        </div>
      </div>

    </main>
  );
}
