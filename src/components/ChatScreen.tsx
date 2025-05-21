import { useEffect, useMemo, useRef, useState } from 'react';
import { CallbackGeneratedChunk, useAppContext } from '../utils/app.context';
import ChatMessage from './ChatMessage';
import { CanvasType, Message, PendingMessage } from '../utils/types';
import { classNames, cleanCurrentUrl, throttle } from '../utils/misc';
import CanvasPyInterpreter from './CanvasPyInterpreter';
import StorageUtils from '../utils/storage';
import { useVSCodeContext } from '../utils/llama-vscode';
// import { Send, StopCircle } from 'lucide-react';

/**
 * A message display is a message node with additional information for rendering.
 * For example, siblings of the message node are stored as their last node (aka leaf node).
 */
export interface MessageDisplay {
  msg: Message | PendingMessage;
  siblingLeafNodeIds: Message['id'][];
  siblingCurrIdx: number;
  isPending?: boolean;
}

/**
 * If the current URL contains "?m=...", prefill the message input with the value.
 * If the current URL contains "?q=...", prefill and SEND the message.
 */
const prefilledMsg = {
  content() {
    const url = new URL(window.location.href);
    return url.searchParams.get('m') ?? url.searchParams.get('q') ?? '';
  },
  shouldSend() {
    const url = new URL(window.location.href);
    return url.searchParams.has('q');
  },
  clear() {
    cleanCurrentUrl(['m', 'q']);
  },
};

function getListMessageDisplay(
  msgs: Readonly<Message[]>,
  leafNodeId: Message['id']
): MessageDisplay[] {
  const currNodes = StorageUtils.filterByLeafNodeId(msgs, leafNodeId, true);
  const res: MessageDisplay[] = [];
  const nodeMap = new Map<Message['id'], Message>();
  for (const msg of msgs) {
    nodeMap.set(msg.id, msg);
  }
  // find leaf node from a message node
  const findLeafNode = (msgId: Message['id']): Message['id'] => {
    let currNode: Message | undefined = nodeMap.get(msgId);
    while (currNode) {
      if (currNode.children.length === 0) break;
      currNode = nodeMap.get(currNode.children.at(-1) ?? -1);
    }
    return currNode?.id ?? -1;
  };
  // traverse the current nodes
  for (const msg of currNodes) {
    const parentNode = nodeMap.get(msg.parent ?? -1);
    if (!parentNode) continue;
    const siblings = parentNode.children;
    if (msg.type !== 'root') {
      res.push({
        msg,
        siblingLeafNodeIds: siblings.map(findLeafNode),
        siblingCurrIdx: siblings.indexOf(msg.id),
      });
    }
  }
  return res;
}

const scrollToBottom = throttle(
  (requiresNearBottom: boolean, delay: number = 80) => {
    const mainScrollElem = document.getElementById('main-scroll');
    if (!mainScrollElem) return;
    const spaceToBottom =
      mainScrollElem.scrollHeight -
      mainScrollElem.scrollTop -
      mainScrollElem.clientHeight;
    if (!requiresNearBottom || spaceToBottom < 50) {
      setTimeout(
        () => mainScrollElem.scrollTo({ top: mainScrollElem.scrollHeight }),
        delay
      );
    }
  },
  80
);

export default function ChatScreen() {
  const {
    viewingChat,
    sendMessage,
    isGenerating,
    stopGenerating,
    pendingMessages,
    canvasData,
    replaceMessageAndGenerate,
  } = useAppContext();
  const textarea = useOptimizedTextarea(prefilledMsg.content());

  const { extraContext, clearExtraContext } = useVSCodeContext(textarea);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // TODO: improve this when we have "upload file" feature
  const currExtra: Message['extra'] = extraContext ? [extraContext] : undefined;

  // keep track of leaf node for rendering
  const [currNodeId, setCurrNodeId] = useState<number>(-1);
  const messages: MessageDisplay[] = useMemo(() => {
    if (!viewingChat) return [];
    else return getListMessageDisplay(viewingChat.messages, currNodeId);
  }, [currNodeId, viewingChat]);

  const currConvId = viewingChat?.conv.id ?? null;
  const pendingMsg: PendingMessage | undefined =
    pendingMessages[currConvId ?? ''];

  useEffect(() => {
    // reset to latest node when conversation changes
    setCurrNodeId(-1);
    // scroll to bottom when conversation changes
    scrollToBottom(false, 1);
  }, [currConvId]);

  const onChunk: CallbackGeneratedChunk = (currLeafNodeId?: Message['id']) => {
    if (currLeafNodeId) {
      setCurrNodeId(currLeafNodeId);
    }
    scrollToBottom(true);
  };

  const sendNewMessage = async () => {
    const lastInpMsg = textarea.value();
    if (lastInpMsg.trim().length === 0 || isGenerating(currConvId ?? ''))
      return;
    textarea.setValue('');
    scrollToBottom(false);
    setCurrNodeId(-1);
    // get the last message node
    const lastMsgNodeId = messages.at(-1)?.msg.id ?? null;
    if (
      !(await sendMessage(
        currConvId,
        lastMsgNodeId,
        lastInpMsg,
        currExtra,
        onChunk
      ))
    ) {
      // restore the input message if failed
      textarea.setValue(lastInpMsg);
    }
    // OK
    clearExtraContext();
  };

  const sendFisrtMessage = async () => {
    var config = StorageUtils.getConfig();
    const lastInpMsg = "- Fais un resumé des informations du patient fournies ci-dessous : \n " + config.systemMessage 
    + "\n - et donne le resultat sous la forme : Bienvenu(e) Docteur ...., Je vais vous aider à effectuer un diagnostic médical sur le patient ... agé de ... ans, avec un historique presentant .... .";
    
    if (lastInpMsg.trim().length === 0 || isGenerating(currConvId ?? ''))
      return;
    
    textarea.setValue('');
    scrollToBottom(false);
    setCurrNodeId(-1);
    // get the last message node
    const lastMsgNodeId = messages.at(-1)?.msg.id ?? null;
    if (
      !(await sendMessage(
        currConvId,
        lastMsgNodeId,
        lastInpMsg,
        currExtra,
        onChunk
      ))
    ) {
      // restore the input message if failed
      textarea.setValue(lastInpMsg);
    }
    // OK
    clearExtraContext();
  };

  const handleEditMessage = async (msg: Message, content: string) => {
    if (!viewingChat) return;
    setCurrNodeId(msg.id);
    scrollToBottom(false);
    await replaceMessageAndGenerate(
      viewingChat.conv.id,
      msg.parent,
      content,
      msg.extra,
      onChunk
    );
    setCurrNodeId(-1);
    scrollToBottom(false);
  };

  const handleRegenerateMessage = async (msg: Message) => {
    if (!viewingChat) return;
    setCurrNodeId(msg.parent);
    scrollToBottom(false);
    await replaceMessageAndGenerate(
      viewingChat.conv.id,
      msg.parent,
      null,
      msg.extra,
      onChunk
    );
    setCurrNodeId(-1);
    scrollToBottom(false);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setSelectedFiles(Array.from(event.target.files));
      scrollToBottom(false);
      setCurrNodeId(-1);
    }
  };

  const handleFileRemove = (index: number) => {
    setSelectedFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
    scrollToBottom(false);
    setCurrNodeId(-1);
  };

  const hasCanvas = !!canvasData;

  useEffect(() => {
    if (prefilledMsg.shouldSend()) {
      // send the prefilled message if needed
      sendNewMessage();
    } else {
      // otherwise, focus on the input
      textarea.focus();
    }
    prefilledMsg.clear();
    // no need to keep track of sendNewMessage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textarea.ref]);

  // ask the model to generate the first message on page loaded or refreshed
  // this is a workaround to avoid the model to generate the first message when the page is refreshed

  useEffect(() => {
    if (messages.length === 0 && !isGenerating(currConvId ?? '')) {
      sendFisrtMessage();
    }
  }, []);

  // due to some timing issues of StorageUtils.appendMsg(), we need to make sure the pendingMsg is not duplicated upon rendering (i.e. appears once in the saved conversation and once in the pendingMsg)
  const pendingMsgDisplay: MessageDisplay[] =
    pendingMsg && messages.at(-1)?.msg.id !== pendingMsg.id
      ? [
          {
            msg: pendingMsg,
            siblingLeafNodeIds: [],
            siblingCurrIdx: 0,
            isPending: true,
          },
        ]
      : [];

  return (
    <div
      className={classNames({
        'grid lg:gap-8 grow transition-[300ms]': true,
        'grid-cols-[1fr_0fr] lg:grid-cols-[1fr_1fr]': hasCanvas, // adapted for mobile
        'grid-cols-[1fr_0fr]': !hasCanvas,
      })}
    >
      <div
        className={classNames({
          'flex flex-col w-full max-w-[900px] mx-auto': true,
          'hidden lg:flex': hasCanvas, // adapted for mobile
          flex: !hasCanvas,
        })}
      >
        {/* chat messages */}
        <div id="messages-list" className="grow">
          <div className="mt-auto flex justify-center">
            {/* placeholder to shift the message to the bottom */}
            {viewingChat ? '' : 'Envoyez un message pour commencer...'}
          </div>
          {[...messages, ...pendingMsgDisplay].map((msg) => (
            <ChatMessage
              key={msg.msg.id}
              msg={msg.msg}
              siblingLeafNodeIds={msg.siblingLeafNodeIds}
              siblingCurrIdx={msg.siblingCurrIdx}
              onRegenerateMessage={handleRegenerateMessage}
              onEditMessage={handleEditMessage}
              onChangeSibling={setCurrNodeId}
            />
          ))}
        </div>

        {/* chat input */}
        <div className="p-2 rounded-2xl dark:bg-gray-900 border-none items-center gap-2  pt-8 pb-6 sticky bottom-0 bg-base-100">
          {selectedFiles.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border-none">
              <div className="mb-2 flex flex-wrap gap-2">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="relative p-2 bg-gray-200 dark:bg-gray-900 rounded">
                    {file.type.startsWith('image/') ? (
                      <img src={URL.createObjectURL(file)} alt={file.name} className="w-16 h-16 object-cover rounded" />
                    ) : (
                      file.name
                    )}
                    <button
                      className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
                      onClick={() => handleFileRemove(index)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                        <path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>

                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className='max-w-10xl w-full flex items-center gap-2 '>
            <label className="inline-flex justify-center p-2 text-gray-500 rounded-lg cursor-pointer hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6">
                  <path fill-rule="evenodd" d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
                </svg>
                
                <input type="file" className="hidden" multiple onChange={handleFileChange} />
            </label>
            <textarea
              className="min-h-full bg-transparent border-none rounded-lg outline-none px-6 w-full max-w-full resize-none"
              // onInput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
              // rows={1}
              // style={{overflow: 'hidden', maxHeight: 350}}
              placeholder="Entrez un message ..."
              ref={textarea.ref}
              onInput={() => {
                if (textarea.ref.current) {
                  textarea.ref.current.style.height = 'auto';
                  textarea.ref.current.style.height = `${Math.min(textarea.ref.current.scrollHeight, 6 * 24)}px`;
                }
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && e.shiftKey) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendNewMessage();
                }
              }}
              id="msg-input"
              dir="auto"
            ></textarea>
            {isGenerating(currConvId ?? '') ? (
              <button
                className="btn btn-neutral ml-2"
                onClick={() => stopGenerating(currConvId ?? '')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24" height="24" className="size-6">
                  <path fill-rule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clip-rule="evenodd" />
                </svg>

              </button>
            ) : (
              <button className="btn btn-primary ml-2" onClick={sendNewMessage}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="24" height="24" className="size-6">
                  <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                </svg>
              </button>
            )}

          </div>
        </div>
      </div>
      <div className="w-full sticky top-[7em] h-[calc(100vh-9em)]">
        {canvasData?.type === CanvasType.PY_INTERPRETER && (
          <CanvasPyInterpreter />
        )}
      </div>
    </div>
  );
}

export interface OptimizedTextareaValue {
  value: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  ref: React.RefObject<HTMLTextAreaElement>;
}

// This is a workaround to prevent the textarea from re-rendering when the inner content changes
// See https://github.com/ggml-org/llama.cpp/pull/12299
function useOptimizedTextarea(initValue: string): OptimizedTextareaValue {
  const [savedInitValue, setSavedInitValue] = useState<string>(initValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current && savedInitValue) {
      textareaRef.current.value = savedInitValue;
      setSavedInitValue('');
    }
  }, [textareaRef, savedInitValue, setSavedInitValue]);

  return {
    value: () => {
      return textareaRef.current?.value ?? savedInitValue;
    },
    setValue: (value: string) => {
      if (textareaRef.current) {
        textareaRef.current.value = value;
      }
    },
    focus: () => {
      if (textareaRef.current) {
        // focus and move the cursor to the end
        textareaRef.current.focus();
        textareaRef.current.selectionStart = textareaRef.current.value.length;
      }
    },
    ref: textareaRef,
  };
}
