import Shamisen from "./shamisen.js?raw"
import DubstepDrone from "./dubstep_drone.js?raw"
import Breakbeat from "./breakbeat.js?raw"
import {CodeEditorExample} from "@/ui/code-editor/CodeEditorState"

export const MyInstruments: ReadonlyArray<CodeEditorExample> = [
    {name: "Shamisen", code: Shamisen},
    {name: "Dubstep Drone", code: DubstepDrone},
    {name: "Breakbeat Kit", code: Breakbeat}
]
