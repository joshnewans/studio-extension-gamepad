import { fromDate } from "@foxglove/rostime";
import { PanelExtensionContext, RenderState, Topic, MessageEvent, SettingsTreeNode, SettingsTreeNodes, SettingsTreeFields, SettingsTreeAction } from "@foxglove/studio";
import { produce } from "immer";
import { get, isEqual, set } from "lodash";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import ReactDOM from "react-dom";

import NoControllerImage from "./images/no-controller.svg";

import DefaultPlaystation3Mapping from "./open-joystick-display/mappings/sony-playstation-3.json";

import { DirectionalMapping, GamepadMapping, Joy } from "./types";

import { useGamepad } from "./hooks/useGamepad";

import { OJDGamepadView } from "./components/OJDGamepadView";
import { ScaleToFit } from "./components/ScaleToFit";


// FIXME Use the public extension API when available
/* eslint-disable @typescript-eslint/no-explicit-any */
// type EXPERIMENTAL_PanelExtensionContextWithSettings = any;
// type SettingsTreeAction = any;
// type SettingsTreeFields = any;
// type SettingsTreeNode = any;
// type SettingsTreeRoots = any;
/* eslint-enable @typescript-eslint/no-explicit-any */


type PanelProps = {
    context: PanelExtensionContext;
};



type Config = {
    topic: string;
    publish_mode: boolean;
    theme: string;
    // TODO: Separate theme and style using OJD nomenclature
    mapping_name: string;
    mapping: GamepadMapping;
};


// Loads a mapping in Open Joystick Display JSON format
function loadOJDMapping(name: string): GamepadMapping {
    // TODO Support more than one mapping
    if (name !== "Sony PlayStation 3")
        throw new Error("Not yet implemented");

    const ojdMapping = DefaultPlaystation3Mapping;
    return {
        buttons: ojdMapping.button.map((button) => ({
            name: button.button,
            index: button.index,
        })),
        directionals: ojdMapping.directional.map((directional) => ({
            x: directional.axes[0] ?? 0,
            y: directional.axes[1] ?? 1,
            deadzone: directional.deadzone,
        })),
    };
}


// Finds button indices that have multiple mappings
function getButtonIndexConflicts(config: Config): number[] {
    // Count the number of times each index is used
    const usedIndices: Record<number, number> = {};
    config.mapping.buttons.forEach((button) => {
        usedIndices[button.index] = (usedIndices[button.index] ?? 0) + 1;
    });

    // Return only the ones that are used more than once
    return Object.entries(usedIndices)
        .filter(([_k, v]) => (v > 1))
        .map(([k, _v]) => parseInt(k));
}

// Finds button names that have multiple mappings
function getButtonNameConflicts(config: Config): string[] {
    // Count the number of times each name is used
    const usedNames: Record<string, number> = {};
    config.mapping.buttons.forEach((button) => {
        usedNames[button.name] = (usedNames[button.name] ?? 0) + 1;
    });

    // Return only the ones that are used more than once
    return Object.entries(usedNames)
        .filter(([_k, v]) => (v > 1))
        .map(([k, _v]) => k);
}


// Finds axis indices that have multiple mappings
function getAxisConflicts(config: Config): number[] {
    // Count the number of times each index is used
    const usedIndices: Record<number, number> = {};
    config.mapping.directionals.forEach((button) => {
        usedIndices[button.x] = (usedIndices[button.x] ?? 0) + 1;
        usedIndices[button.y] = (usedIndices[button.y] ?? 0) + 1;
    });

    // Return only the ones that are used more than once
    return Object.entries(usedIndices)
        .filter(([_k, v]) => (v > 1))
        .map(([k, _v]) => parseInt(k));
}


// Finds the next unused button index
function getNextButtonIndex(config: Config): number {
    return config.mapping.buttons
        .map((button) => button.index)
        .sort((a, b) => (a - b))  // omfg JavaScript
        .reduce((result, i) => ((i === result) ? result + 1 : result), 0);
}


// Finds the next unused axis index
function getNextAxisIndex(config: Config): number {
    return config.mapping.directionals
        .map((directional) => [directional.x, directional.y])
        .flat()
        .sort((a, b) => (a - b))  // omfg JavaScript
        .reduce((result, i) => ((i === result) ? result + 1 : result), 0);
}


function buildSettingsTree(
    config: Config,
    isReadOnly: boolean,
    topics?: readonly Topic[],
): SettingsTreeNodes {
    const generalFields: SettingsTreeFields = {
        topic: {
            label: "Topic",
            input: (isReadOnly ? "select" : "string"),
            value: config.topic,
            options: (topics ?? [])
            .filter((topic) => (topic.datatype === "sensor_msgs/Joy"))
            .map((topic) =>({
                label: topic.name,
                value: topic.name,
            })),
            // error: (!config.topic ? "Topic name is empty" : null),

        },

        publish_mode: {
            label: "Publish Mode",
            input: "boolean",
            value: config.publish_mode,
        },

        theme: {
            label: "Theme",
            input: "select",
            value: config.theme,
            options: [
                {
                    label: "Sony Playstation – Analog Black",
                    value: "ps3-analog-black",
                },
            ],
        },


        mapping: {
            label: "Mapping",
            input: "select",
            value: config.mapping_name,
            options: [
                {
                    label: "Sony PlayStation 3",
                    value: "Sony PlayStation 3",
                },
                {
                    label: "Custom",
                    value: "custom",
                },
            ],
        },
    };

    const buttonIndexConflicts = getButtonIndexConflicts(config);
    const buttonNameConflicts = getButtonNameConflicts(config);
    const buttonNodes: SettingsTreeNodes = {};
    config.mapping.buttons.forEach((button, i) => {
        buttonNodes[i] = {
            label: `Button ${button.name}`,
            defaultExpansionState: (
                (button.showInEditor ?? false) ? "expanded" : "collapsed"
            ),
            actions: [
                {
                    type: "action",
                    id: "delete_mapping",
                    label: "Delete Button",
                },
            ],
            fields: {
                name: {
                    label: "Name",
                    input: "string",
                    value: button.name,
                    // error: (
                    //     button.name.length === 0 ?
                    //     "Button name is empty" :
                    //     buttonNameConflicts.includes(button.name) ?
                    //     "Name is used multiple times" : null
                    // )
                },
                index: {
                    label: "Index",
                    input: "number",
                    min: 0,
                    step: 1,
                    value: button.index,
                    // error: (
                    //     buttonIndexConflicts.includes(button.index) ?
                    //     "Index is used multiple times" : null
                    // ),
                },
            },
        };
    });

    const axisConflicts = getAxisConflicts(config);
    const directionalNodes: SettingsTreeNodes = {};
    config.mapping.directionals.forEach((directional, i) => {
        directionalNodes[i] = {
            label: `Directional ${i+1}`,
            defaultExpansionState: (
                (directional.showInEditor ?? false) ? "expanded" : "collapsed"
            ),
            actions: [
                {
                    type: "action",
                    id: "delete_mapping",
                    label: "Delete Directional",
                },
            ],
            fields: {
                x: {
                    label: "X-Axis",
                    input: "number",
                    min: 0,
                    step: 1,
                    value: directional.x,
                    // error: (
                    //     axisConflicts.includes(directional.x) ?
                    //     "Index is used multiple times" : null
                    // ),
                },
                y: {
                    label: "Y-Axis",
                    input: "number",
                    min: 0,
                    step: 1,
                    value: directional.y,
                    // error: (
                    //     axisConflicts.includes(directional.y) ?
                    //     "Index is used multiple times" : null
                    // ),
                },
                deadzone: {
                    label: "Deadzone",
                    input: "number",
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                    precision: 2,
                    value: directional.deadzone,
                },
            }
        };
    });

    const settings: SettingsTreeNodes = {
        general: {
            label: "General",
            fields: generalFields,
        },

        buttons: {
            label: "Buttons",
            defaultExpansionState: "collapsed",
            actions: [
                {
                    type: "action",
                    id: "add_button",
                    label: "Add Button",
                },
            ],
            children: buttonNodes,
        },

        directionals: {
            label: "Directionals",
            defaultExpansionState: "collapsed",
            actions: [
                {
                    type: "action",
                    id: "add_directional",
                    label: "Add Directional",
                },
            ],
            children: directionalNodes,
        },
    };

    return settings;
}


function GamepadPanel({ context }: PanelProps): JSX.Element {
    const [gamepad, setGamepad] = useState<number | undefined>();
    const [joy, setJoy] = useState<Joy | undefined>();

    const [topics, setTopics] = useState<readonly Topic[] | undefined>();
    const [usedTopic, setUsedTopic] = useState<string | undefined>();
    const [messages, setMessages] = useState<readonly MessageEvent<unknown>[] | undefined>();

    const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

    const [config, setConfig] = useState<Config>(() => {
        const config = context.initialState as Partial<Config>;
        config.topic ??= "/joy";
        config.publish_mode ??= false;
        config.theme ??= "ps3-analog-black";
        config.mapping_name ??= "Sony PlayStation 3";
        config.mapping ??= loadOJDMapping(config.mapping_name);
        return config as Config;
    });

    // Determine if we are attached to a player on which we can publish events
    // const isReadonly = ("publish" in context);
    const isReadonly = false;

    // Persist the config each time it is modified
    useEffect(() => {
        context.saveState(produce(config, (draft) => {
            // Do not persist the showInEditor property
            draft.mapping.buttons.forEach((button) => {
                delete button.showInEditor;
            });
            draft.mapping.directionals.forEach((directional) => {
                delete directional.showInEditor;
            });
        }));
    }, [config, context]);

    const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
        if (action.action === "perform-node-action") {
            const { id: action_id, path } = action.payload;

            if (action_id === "add_button") {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    draft.mapping.buttons.push({
                        name: "NEW_BUTTON",
                        index: getNextButtonIndex(draft),
                        showInEditor: true,
                    });
                    draft.mapping_name = "custom";
                }));
            }

            if (action_id === "add_directional") {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    const newEntry: DirectionalMapping = {
                        x: -1, y: -1, // updated below
                        deadzone: 0.25,
                        showInEditor: true,
                    }
                    draft.mapping.directionals.push(newEntry);
                    newEntry.x = getNextAxisIndex(draft);
                    newEntry.y = getNextAxisIndex(draft);
                    draft.mapping_name = "custom";
                }));
            }

            else if (action_id === "delete_mapping") {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    // lodash's unset() doesn't remove an array element as
                    // desired (https://github.com/lodash/lodash/issues/3870)
                    get(draft.mapping, path.slice(0, -1))
                        .splice(path[path.length - 1], 1);
                    draft.mapping_name = "custom";
                }));
            }

            return;
        }

        if (action.action === "update") {
            const { path, value } = action.payload;

            if (path[0] === "general" && ["topic", "theme"].includes(path[1] as string)) {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    set(draft, path.slice(1), value);
                }));
            }

            if (path[0] === "general" && ["publish_mode"].includes(path[1] as string)) {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    set(draft, path.slice(1), value);
                }));
            }


            if (isEqual(path, ["general", "mapping"])) {
                if (value === "custom") {
                    setConfig((oldConfig) => produce(oldConfig, (draft) => {
                        draft.mapping_name = "custom";
                        draft.mapping = {
                            buttons: [],
                            directionals: [],
                        };
                    }));
                } else {
                    setConfig((oldConfig) => produce(oldConfig, (draft) => {
                        draft.mapping_name = value as string;
                        draft.mapping = loadOJDMapping(value as string);
                    }));
                }
            }

            if (["buttons", "directionals"].includes(path[0] as string)) {
                setConfig((oldConfig) => produce(oldConfig, (draft) => {
                    set(draft.mapping, path, value);
                    draft.mapping_name = "custom";
                }));
            }

            return;
        }
    }, []);

    // Register the settings tree
    useEffect(() => {
          context.updatePanelSettingsEditor({
          actionHandler: settingsActionHandler,
          nodes: buildSettingsTree(config, isReadonly, topics),
        });
      }, [config, context, isReadonly, settingsActionHandler, topics]);

    // We use a layout effect to setup render handling for our panel. We also setup some topic subscriptions.
    useLayoutEffect(() => {
        // The render handler is run by the broader studio system during playback when your panel
        // needs to render because the fields it is watching have changed. How you handle rendering depends on your framework.
        // You can only setup one render handler - usually early on in setting up your panel.
        //
        // Without a render handler your panel will never receive updates.
        //
        // The render handler could be invoked as often as 60hz during playback if fields are changing often.
        context.onRender = (renderState: RenderState, done) => {
            console.log("zzzzzza");
            // render functions receive a _done_ callback. You MUST call this callback to indicate your panel has finished rendering.
            // Your panel will not receive another render callback until _done_ is called from a prior render. If your panel is not done
            // rendering before the next render call, studio shows a notification to the user that your panel is delayed.
            //
            // Set the done callback into a state variable to trigger a re-render.
            setRenderDone(() => done);

            // We may have new topics - since we are also watching for messages in the current frame, topics may not have changed
            // It is up to you to determine the correct action when state has not changed.
            setTopics(renderState.topics);

            // currentFrame has messages on subscribed topics since the last render call
            setMessages(renderState.currentFrame);
        };

        // After adding a render handler, you must indicate which fields from RenderState will trigger updates.
        // If you do not watch any fields then your panel will never render since the panel context will assume you do not want any updates.

        // tell the panel context that we care about any update to the _topic_ field of RenderState
        context.watch("topics");

        // tell the panel context we want messages for the current frame for topics we've subscribed to
        // This corresponds to the _currentFrame_ field of render state.
        context.watch("currentFrame");
    }, [context]);

    // Advertise the relevant topic when in a live session
    useEffect(() => {
        console.log("do a thinkg");
        if (config.publish_mode) {
            if (isReadonly)
            {
                // TODO: Failure here or better capture elsewhere?
                console.log("Should not attempt to publish when read only");
            }
            
            setUsedTopic((oldTopic) => {
                if (oldTopic)
                    context.unadvertise?.(oldTopic);
                context.advertise?.("/joy", "sensor_msgs/Joy");
                return config.topic;
            });
        }
    }, [config.topic, config.publish_mode, context, isReadonly]);

    // Or subscribe to the relevant topic when in a recorded session
    useEffect(() => {
        if (!config.publish_mode) {
            setUsedTopic((_oldTopic) => {
                context.subscribe([ config.topic ]);
                return config.topic;
            });
        }
    }, [config.topic, config.publish_mode, context, isReadonly]);

    // If subscribing
    useEffect(() => {
        const latestJoy = (
            messages?.[messages?.length - 1]?.message as Joy | undefined
        );
        if (latestJoy)
            setJoy(latestJoy);
    }, [messages]);

    useGamepad({
        didConnect: useCallback((gp: Gamepad) => {
            if (gamepad == undefined) {
                setGamepad(gp.index);
            }
        }, [gamepad]),

        didDisconnect: useCallback((gp: Gamepad) => {
            if (gamepad === gp.index) {
                setGamepad(undefined);
                setJoy(undefined);
            }
        }, [gamepad]),

        didUpdate: useCallback((gp: Gamepad) => {
            // if (isReadonly || gamepad !== gp.index)
            //     return;
            if (!config.publish_mode)
            {
                return;
            }

            setJoy((prev) => ({
                header: {
                    frame_id: gp.id,
                    stamp: fromDate(new Date()),  // TODO: /clock
                    seq: (prev?.header.seq ?? -1) + 1,
                },
                axes: [...gp.axes],
                buttons: gp.buttons.map(
                    (button) => (button.pressed ? 1 : 0)
                ),
            }));

            var tmpjoy = {
                header: {
                    frame_id: '',
                    stamp: fromDate(new Date()),  // TODO: /clock // TODO: Can leave off as it's added automatically?
                },
                axes: [...gp.axes],
                buttons: gp.buttons.map(
                    (button) => (button.pressed ? 1 : 0)
                ),
            };
            // console.log(tmpjoy);
            context.publish?.("/joy", tmpjoy);
        }, [gamepad, isReadonly, config.publish_mode]),
    });

    // Invoke the done callback once the render is complete
    useEffect(() => {
        renderDone?.();
    }, [renderDone]);

    return (
        <ScaleToFit>
            { joy ?
                <OJDGamepadView gamepad={joy} mapping={config.mapping} /> :
                <div dangerouslySetInnerHTML={{ __html: NoControllerImage }} /> /* FIXME */
            }
        </ScaleToFit>
    );
}

export function initGamepadPanel(context: PanelExtensionContext): void {
    ReactDOM.render(<GamepadPanel context={context} />, context.panelElement);
}
