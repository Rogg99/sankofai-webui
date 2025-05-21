import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  APIMessage,
  CanvasData,
  Conversation,
  Message,
  PendingMessage,
  ViewingChat,
} from './types';
import StorageUtils from './storage';
import {
  filterThoughtFromMsgs,
  normalizeMsgsForAPI,
  getSSEStreamAsync,
} from './misc';
import { BASE_URL, CONFIG_DEFAULT, isDev } from '../Config';
import { matchPath, useLocation, useNavigate } from 'react-router';

interface AppContextValue {
  // conversations and messages
  viewingChat: ViewingChat | null;
  pendingMessages: Record<Conversation['id'], PendingMessage>;
  isGenerating: (convId: string) => boolean;
  sendMessage: (
    convId: string | null,
    leafNodeId: Message['id'] | null,
    content: string,
    extra: Message['extra'],
    onChunk: CallbackGeneratedChunk
  ) => Promise<boolean>;
  stopGenerating: (convId: string) => void;
  replaceMessageAndGenerate: (
    convId: string,
    parentNodeId: Message['id'], // the parent node of the message to be replaced
    content: string | null,
    extra: Message['extra'],
    onChunk: CallbackGeneratedChunk
  ) => Promise<void>;

  // canvas
  canvasData: CanvasData | null;
  setCanvasData: (data: CanvasData | null) => void;

  // config
  config: typeof CONFIG_DEFAULT;
  saveConfig: (config: typeof CONFIG_DEFAULT) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}

// this callback is used for scrolling to the bottom of the chat and switching to the last node
export type CallbackGeneratedChunk = (currLeafNodeId?: Message['id']) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppContext = createContext<AppContextValue>({} as any);

const getViewingChat = async (convId: string): Promise<ViewingChat | null> => {
  const conv = await StorageUtils.getOneConversation(convId);
  if (!conv) return null;
  return {
    conv: conv,
    // all messages from all branches, not filtered by last node
    messages: await StorageUtils.getMessages(convId),
  };
};

export const AppContextProvider = ({
  children,
}: {
  children: React.ReactElement;
}) => {
  // const { patient } = useParams<Params>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const params = matchPath('/chat/:convId', pathname);
  const convId = params?.params?.convId;

  const [viewingChat, setViewingChat] = useState<ViewingChat | null>(null);
  const [pendingMessages, setPendingMessages] = useState<
    Record<Conversation['id'], PendingMessage>
  >({});
  const [aborts, setAborts] = useState<
    Record<Conversation['id'], AbortController>
  >({});
  const [config, setConfig] = useState(StorageUtils.getConfig());
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [initPatientDatas, setInitPatientDatas] = useState(false);

  const searchParams = new URLSearchParams(window.location.search);
  const patientId  = searchParams.get("patient");
  const doctorId  = searchParams.get("client");
  console.log("patientId:", patientId);
  console.log("doctorId:", doctorId);
  console.log("window.location.href:", window.location.href);

  const saveConfig = (config: typeof CONFIG_DEFAULT) => {
    StorageUtils.setConfig(config);
    setConfig(config);
  };

  var dynamicSystemMessage = `${config.systemMessage}`;

  // useEffect(() => {
  //   if (patient) {
  //     setInitPatientDatas(false);
  //   }
  // }, [patient]);

  // handle change when the convId from URL is changed
  useEffect(() => {
    // also reset the canvas data
    setCanvasData(null);
    const handleConversationChange = async (changedConvId: string) => {
      if (changedConvId !== convId) return;
      setViewingChat(await getViewingChat(changedConvId));
    };
    StorageUtils.onConversationChanged(handleConversationChange);
    getViewingChat(convId ?? '').then(setViewingChat);
    return () => {
      StorageUtils.offConversationChanged(handleConversationChange);
    };
  }, [convId]);

  useEffect(() => {

    // console.log("patientId:", patientId); // "summary"
    if (!initPatientDatas) {
    // Fetch patient data from the API
      console.log('Fetching patient data...'); // Debug log
      var patientData = '';
      var doctorName = '';
      var doctorSpeciality = 'generalist';
      
      const systemMessage_core = "Vous êtes Sankof, un assistant médical expert interactif. Suivez rigoureusement ces instructions :"
      + "\n- Résumez les informations du patient fournies ci-dessous."
      + "\n- Soyez interactif et posez des questions pour recueillir plus de détails sur l'état du patient."
      + "\n- Fournissez des diagnostics précis et des suggestions pour de bonnes habitudes, des médicaments ou des lignes directrices."
      + "\n- Concentrez-vous toujours sur les faits et évitez les répétitions."
      + "\n- Répondez uniquement en français."
      + "\n\n- #################### \n";

      var doctor_core = 
        "\n- Votre interlocuteur est un médecin " + doctorSpeciality + " nommé " + doctorName + "."
      + "\n- Il est important de lui poser des questions pour obtenir des informations supplémentaires sur l'état du patient."
      + "\n\n- #################### \n";

      var systemMessage = CONFIG_DEFAULT.systemMessage; 

      fetch('http://161.97.165.193:19000/api/data/'+patientId).then((response) => {
        if (response.ok) {
          var responseJson = response.json();
          responseJson.then((data) => {
            console.log('Fetched patient data:', data); // Debug log
            patientData = JSON.stringify(data.data, null, 2);
            console.log('Patient data:', patientData); // Debug log

            console.log('Fetched doctor data:', data); // Debug log
            doctorName = data.specialist.name;
            doctorSpeciality = data.specialist.speciality;

            var doctor_core = 
                  "\n- Votre interlocuteur est un médecin " + doctorSpeciality + " nommé " + doctorName + "."
                  + "\n- Il est important de lui poser des questions pour obtenir des informations supplémentaires sur l'état du patient."
                  + "\n\n- #################### \n";

            // Dynamically append doctor data to the system message
            dynamicSystemMessage = `${systemMessage_core}\n\nDonnées du patient:\n${patientData}\nDonnées du médecin:\n${doctor_core}`;
            config.systemMessage = dynamicSystemMessage;

            // console.log('Patient data fetched:', patientData); // Debug log
            // Dynamically append patient data to the system message
            //dynamicSystemMessage = `${systemMessage}\n\nDonnées du patient:\n${patientData}\n\nDonnées du médecin:\n${doctor_core}`;
            //config.systemMessage = dynamicSystemMessage;
            saveConfig(config);
            setConfig(config);
            
          });
        }
        else {
          console.error('Error fetching patient data:', response.statusText);
        }
      });
    }
  },[initPatientDatas])

  const setPending = (convId: string, pendingMsg: PendingMessage | null) => {
    // if pendingMsg is null, remove the key from the object
    if (!pendingMsg) {
      setPendingMessages((prev) => {
        const newState = { ...prev };
        delete newState[convId];
        return newState;
      });
    } else {
      setPendingMessages((prev) => ({ ...prev, [convId]: pendingMsg }));
    }
  };

  const setAbort = (convId: string, controller: AbortController | null) => {
    if (!controller) {
      setAborts((prev) => {
        const newState = { ...prev };
        delete newState[convId];
        return newState;
      });
    } else {
      setAborts((prev) => ({ ...prev, [convId]: controller }));
    }
  };

  ////////////////////////////////////////////////////////////////////////
  // public functions

  const isGenerating = (convId: string) => !!pendingMessages[convId];



  const generateMessage = async (
    convId: string,
    leafNodeId: Message['id'],
    onChunk: CallbackGeneratedChunk
  ) => {
    console.log('generateMessage called with convId:', convId); // Debug log
    if (isGenerating(convId)) return;

    const config = StorageUtils.getConfig();
    const currConversation = await StorageUtils.getOneConversation(convId);
    if (!currConversation) {
      throw new Error('Current conversation is not found');
    }

    const currMessages = StorageUtils.filterByLeafNodeId(
      await StorageUtils.getMessages(convId),
      leafNodeId,
      false
    );
    const abortController = new AbortController();
    setAbort(convId, abortController);

    if (!currMessages) {
      throw new Error('Current messages are not found');
    }

    const pendingId = Date.now() + 1;
    let pendingMsg: PendingMessage = {
      id: pendingId,
      convId,
      type: 'text',
      timestamp: pendingId,
      role: 'assistant',
      content: null,
      parent: leafNodeId,
      children: [],
    };
    setPending(convId, pendingMsg);

    try {
      // Dynamically append patient data to the system message
      // const dynamicSystemMessage = `${config.systemMessage}\n\n Données du patient:\n${patientData}`;
      config.systemMessage = dynamicSystemMessage;
      saveConfig(config);

      console.log('Dynamic system message:', dynamicSystemMessage); // Debug log
      // prepare messages for API
      let messages: APIMessage[] = [
        ...(dynamicSystemMessage.length === 0
          ? []
          : [{ role: 'system', content: dynamicSystemMessage} as APIMessage]),
        ...normalizeMsgsForAPI(currMessages),
      ];
      console.log('Prepared messages:', messages); // Debug log
      if (config.excludeThoughtOnReq) {
        messages = filterThoughtFromMsgs(messages);
      }
      if (isDev) console.log({ messages });

      // prepare params
      const params = {
        messages,
        stream: true,
        cache_prompt: true,
        samplers: config.samplers,
        temperature: config.temperature,
        dynatemp_range: config.dynatemp_range,
        dynatemp_exponent: config.dynatemp_exponent,
        top_k: config.top_k,
        top_p: config.top_p,
        min_p: config.min_p,
        typical_p: config.typical_p,
        xtc_probability: config.xtc_probability,
        xtc_threshold: config.xtc_threshold,
        repeat_last_n: config.repeat_last_n,
        repeat_penalty: config.repeat_penalty,
        presence_penalty: config.presence_penalty,
        frequency_penalty: config.frequency_penalty,
        dry_multiplier: config.dry_multiplier,
        dry_base: config.dry_base,
        dry_allowed_length: config.dry_allowed_length,
        dry_penalty_last_n: config.dry_penalty_last_n,
        max_tokens: config.max_tokens,
        timings_per_token: !!config.showTokensPerSecond,
        ...(config.custom.length ? JSON.parse(config.custom) : {}),
      };

      // send request
      // const fetchResponse = await fetch(`${BASE_URL}/v1/chat/completions`, {
      const fetchResponse = await fetch(`http://161.97.165.193:9870/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify(params),
        signal: abortController.signal,
      });
      if (fetchResponse.status !== 200) {
        const body = await fetchResponse.json();
        throw new Error(body?.error?.message || 'Unknown error');
      }
      const chunks = getSSEStreamAsync(fetchResponse);
      for await (const chunk of chunks) {
        // const stop = chunk.stop;
        if (chunk.error) {
          throw new Error(chunk.error?.message || 'Unknown error');
        }
        const addedContent = chunk.choices[0].delta.content;
        const lastContent = pendingMsg.content || '';
        if (addedContent) {
          pendingMsg = {
            ...pendingMsg,
            content: lastContent + addedContent,
          };
        }
        const timings = chunk.timings;
        if (timings && config.showTokensPerSecond) {
          // only extract what's really needed, to save some space
          pendingMsg.timings = {
            prompt_n: timings.prompt_n,
            prompt_ms: timings.prompt_ms,
            predicted_n: timings.predicted_n,
            predicted_ms: timings.predicted_ms,
          };
        }
        setPending(convId, pendingMsg);
        onChunk(); // don't need to switch node for pending message
      }
    } catch (err) {
      setPending(convId, null);
      if ((err as Error).name === 'AbortError') {
        // user stopped the generation via stopGeneration() function
        // we can safely ignore this error
      } else {
        console.error(err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        alert((err as any)?.message ?? 'Unknown error');
        throw err; // rethrow
      }
    }

    if (pendingMsg.content !== null) {
      await StorageUtils.appendMsg(pendingMsg as Message, leafNodeId);
    }
    setPending(convId, null);
    onChunk(pendingId); // trigger scroll to bottom and switch to the last node
  };

  const sendMessage = async (
    convId: string | null,
    leafNodeId: Message['id'] | null,
    content: string,
    extra: Message['extra'],
    onChunk: CallbackGeneratedChunk
  ): Promise<boolean> => {
    if (isGenerating(convId ?? '') || content.trim().length === 0) return false;

    if (convId === null || convId.length === 0 || leafNodeId === null) {
      const conv = await StorageUtils.createConversation(
        content.substring(0, 256)
      );
      convId = conv.id;
      leafNodeId = conv.currNode;
      // if user is creating a new conversation, redirect to the new conversation
      navigate(`/chat/${convId}`);
    }

    const now = Date.now();
    const currMsgId = now;
    StorageUtils.appendMsg(
      {
        id: currMsgId,
        timestamp: now,
        type: 'text',
        convId,
        role: 'user',
        content,
        extra,
        parent: leafNodeId,
        children: [],
      },
      leafNodeId
    );
    onChunk(currMsgId);

    try {
      await generateMessage(convId, currMsgId, onChunk);
      return true;
    } catch (_) {
      // TODO: rollback
    }
    return false;
  };

  const stopGenerating = (convId: string) => {
    setPending(convId, null);
    aborts[convId]?.abort();
  };

  // if content is undefined, we remove last assistant message
  const replaceMessageAndGenerate = async (
    convId: string,
    parentNodeId: Message['id'], // the parent node of the message to be replaced
    content: string | null,
    extra: Message['extra'],
    onChunk: CallbackGeneratedChunk
  ) => {
    if (isGenerating(convId)) return;

    if (content !== null) {
      const now = Date.now();
      const currMsgId = now;
      StorageUtils.appendMsg(
        {
          id: currMsgId,
          timestamp: now,
          type: 'text',
          convId,
          role: 'user',
          content,
          extra,
          parent: parentNodeId,
          children: [],
        },
        parentNodeId
      );
      parentNodeId = currMsgId;
    }
    onChunk(parentNodeId);

    await generateMessage(convId, parentNodeId, onChunk);
  };

  return (
    <AppContext.Provider
      value={{
        isGenerating,
        viewingChat,
        pendingMessages,
        sendMessage,
        stopGenerating,
        replaceMessageAndGenerate,
        canvasData,
        setCanvasData,
        config,
        saveConfig,
        showSettings,
        setShowSettings,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
