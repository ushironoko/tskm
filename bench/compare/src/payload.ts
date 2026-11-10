/** One object, used by every library. Constraints are listed in README.md. */
export const validPayload = {
  id: 7,
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "admin" as const,
  tags: ["math", "engines"],
  active: true,
  score: 88,
  address: { city: "London", zip: "SW1A1AA" },
}

export const invalidPayload = {
  id: 0,
  name: "",
  email: "not-an-email",
  role: "owner",
  tags: [""],
  active: "yes",
  score: 101,
  address: { city: "", zip: "" },
}
