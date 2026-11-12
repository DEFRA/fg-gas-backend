import { searchDeclaration } from "../../../common/search/declaration.js";

// The fields an admin searches a grant's applications by, read from the
// answers merged across its phases, as its pages address them.
export const search = searchDeclaration(["$.answers."]);
