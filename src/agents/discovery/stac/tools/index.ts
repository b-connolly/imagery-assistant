import { searchStacTool } from "./searchStac/adapter";
import { browseCollectionsTool } from "./browseCollections/adapter";
import { addStacResultsTool } from "./addStacResults/adapter";

export const stacSearchTools = [searchStacTool, browseCollectionsTool, addStacResultsTool];
