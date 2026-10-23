const users = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];

export const findUser = (id: string) => users.find((user) => user.id === id);
