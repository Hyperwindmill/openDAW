import Shamisen from "./shamisen.js?raw"
import DubstepDrone from "./dubstep_drone.js?raw"
import {CodeEditorExample} from "@/ui/code-editor/CodeEditorState"

export const MyInstruments: ReadonlyArray<CodeEditorExample> = [
    {name: "Shamisen", code: Shamisen},
    {name: "Dubstep Drone", code: DubstepDrone}
]
