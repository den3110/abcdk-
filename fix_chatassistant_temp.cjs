const fs = require('fs');
const path = 'pickletour-app-mobile/components/chatbot/ChatAssistant.jsx';
let text = fs.readFileSync(path, 'utf8');

text = text.replace(/<Text style=\{styles\.headerSubtitle\}>[\s\S]*?<\/Text>/, [
  '<Text style={styles.headerSubtitle}>',
  '  {isTyping || isSending || isStreaming',
  '    ? "Ðang tr? l?i..."',
  '    : "Luôn s?n sàng h? tr?"}',
  '</Text>',
].join('\n'));

text = text.replace(/<Text style=\{\{ marginTop: 8, color: theme\.subText, fontSize: 13 \}\}>[\s\S]*?<\/Text>/, [
  '<Text style={{ marginTop: 8, color: theme.subText, fontSize: 13 }}>',
  '  {"Ðang t?i h?i tho?i..."}',
  '</Text>',
].join('\n'));

text = text.replace(/<QuickReplyButton[\s\S]*?icon="trophy-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="trophy-outline"',
  '  text={"Gi?i d?u"}',
  '  onPress={() => handleQuickReply("Các gi?i d?u s?p t?i")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="calendar-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="calendar-outline"',
  '  text={"L?ch thi d?u"}',
  '  onPress={() => handleQuickReply("L?ch thi d?u c?a tôi")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="help-circle-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="help-circle-outline"',
  '  text={"Lu?t choi"}',
  '  onPress={() => handleQuickReply("Lu?t pickleball co b?n")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="stats-chart-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="stats-chart-outline"',
  '  text={"X?p h?ng"}',
  '  onPress={() => handleQuickReply("X?p h?ng c?a tôi")}',
  '  theme={theme}',
  '/>',
].join('\n'));

const inputBlockPattern = /\n      \{\/\* Input Area \*\/\}[\s\S]*?\n      \{\/\* Menu Modal \*\/\}/;
const inputBlockReplacement = [
  '',
  '      {/* Input Area */}',
  '      {!isMenuVisible && (',
  '        <KeyboardAvoidingView',
  '          behavior={Platform.OS === "ios" ? "padding" : "padding"}',
  '          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : -tabBarHeight} // Subtract tab bar height',
  '        >',
  '          {isSessionLimited && !sessionLimitDismissed && (',
  '            <View',
  '              style={{',
  '                paddingHorizontal: 16,',
  '                paddingBottom: 6,',
  '                flexDirection: "row",',
  '                alignItems: "center",',
  '                justifyContent: "space-between",',
  '                backgroundColor: theme.background,',
  '              }}',
  '            >',
  '              <View style={{ flex: 1, paddingRight: 8 }}>',
  '                <Text style={{ fontSize: 12, fontWeight: "700", color: "#ef4444" }}>',
  '                  {"Ðã ch?m gi?i h?n phiên · B?n dã dùng h?t 15 tin nh?n cho lu?t này."}',
  '                </Text>',
  '                {sessionLimitInfo?.resetAt ? (',
  '                  <Text style={{ fontSize: 12, color: "#ef4444", marginTop: 2 }}>',
  '                    {"Có th? chat l?i sau " + formatTimeAmPmFromISO(sessionLimitInfo.resetAt)}',
  '                  </Text>',
  '                ) : null}',
  '              </View>',
  '              <TouchableOpacity onPress={handleDismissSessionBanner}>',
  '                <Ionicons name="close" size={18} color={theme.subText} />',
  '              </TouchableOpacity>',
  '            </View>',
  '          )}',
  '          <View style={[styles.composerToolsRow, { backgroundColor: theme.background }]}>',
  '            <TouchableOpacity',
  '              style={[styles.reasonerToggle, reasoningMode === "force_reasoner" && styles.reasonerToggleActive, { borderColor: theme.inputBorder }]}',
  '              onPress={toggleReasoningMode}',
  '            >',
  '              <Ionicons name={reasoningMode === "force_reasoner" ? "sparkles" : "sparkles-outline"} size={16} color={reasoningMode === "force_reasoner" ? "#7c3aed" : theme.subText} />',
  '              <Text style={[styles.reasonerToggleText, { color: theme.text }]}>',
  '                {reasoningMode === "force_reasoner" ? "Reasoner b?t" : "T? d?ng"}',
  '              </Text>',
  '            </TouchableOpacity>',
  '            <Text style={[styles.reasonerHint, { color: theme.subText }]}>',
  '              {reasoningMode === "force_reasoner" ? "Tin nh?n ti?p theo s? suy lu?n sâu hon." : "B?t khi b?n mu?n Pikora suy lu?n sâu."}',
  '            </Text>',
  '          </View>',
  '          <BlurView',
  '            intensity={95}',
  '            tint={isDark ? "dark" : "light"}',
  '            style={[styles.inputContainer, { borderTopColor: theme.divider }]}',
  '            {...panResponder.panHandlers}',
  '          >',
  '            <View style={styles.inputWrapper}>',
  '              <View style={[styles.textInputContainer, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder }]}>',
  '                <TextInput',
  '                  ref={inputRef}',
  '                  style={[styles.textInput, { color: theme.text }]}',
  '                  placeholder={"Nh?p câu h?i c?a b?n..."}',
  '                  placeholderTextColor={theme.placeholder}',
  '                  value={inputText}',
  '                  onChangeText={setInputText}',
  '                  multiline',
  '                  maxLength={500}',
  '                />',
  '              </View>',
  '',
  '              <TouchableOpacity',
  '                style={[styles.sendButton, (!inputText.trim() && !isStreaming) || isSending ? styles.sendButtonDisabled : null]}',
  '                onPress={() => {',
  '                  if (isStreaming) {',
  '                    streamAbortRef.current?.abort?.();',
  '                    return;',
  '                  }',
  '                  handleSend(inputText);',
  '                }}',
  '                disabled={(!inputText.trim() && !isStreaming) || isSending}',
  '              >',
  '                <LinearGradient',
  '                  colors={isStreaming ? ["#ef4444", "#dc2626"] : inputText.trim() && !isSending ? ["#667eea", "#764ba2"] : isDark ? ["#444", "#444"] : ["#e0e0e0", "#d0d0d0"]}',
  '                  start={{ x: 0, y: 0 }}',
  '                  end={{ x: 1, y: 1 }}',
  '                  style={styles.sendButtonGradient}',
  '                >',
  '                  {isSending ? (',
  '                    <ActivityIndicator size="small" color="#fff" />',
  '                  ) : (',
  '                    <Ionicons name={isStreaming ? "stop" : "send"} size={20} color={isStreaming || inputText.trim() ? "#fff" : "#a0a0a0"} />',
  '                  )}',
  '                </LinearGradient>',
  '              </TouchableOpacity>',
  '            </View>',
  '          </BlurView>',
  '        </KeyboardAvoidingView>',
  '      )}',
  '',
  '      {/* Menu Modal */}',
].join('\n');
if (!inputBlockPattern.test(text)) {
  throw new Error('Input block not found');
}
text = text.replace(inputBlockPattern, inputBlockReplacement);

const menuBlockPattern = /\n      <Modal transparent visible=\{isMenuVisible\} animationType="fade" onRequestClose=\{\(\) => setIsMenuVisible\(false\)\}>[\s\S]*?\n      <Modal transparent visible=\{Boolean\(reasoningTarget\)\}/;
const menuBlockReplacement = [
  '',
  '      <Modal transparent visible={isMenuVisible} animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>',
  '        <View style={styles.menuOverlay}>',
  '          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setIsMenuVisible(false)} />',
  '          <View style={[styles.menuModal, { backgroundColor: theme.menuBg, shadowColor: theme.shadow }]}>',
  '            <Text style={[styles.menuTitle, { color: theme.subText }]}>Tùy ch?n</Text>',
  '            <TouchableOpacity style={styles.menuItem} onPress={handleClearChat}>',
  '              <Ionicons name="trash-outline" size={18} color="#e53935" style={styles.menuItemIcon} />',
  '              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>Xóa toàn b? h?i tho?i</Text>',
  '            </TouchableOpacity>',
  '            <TouchableOpacity style={styles.menuItem} onPress={handleFeedback}>',
  '              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.subText} style={styles.menuItemIcon} />',
  '              <Text style={[styles.menuItemText, { color: theme.text }]}>G?i feedback</Text>',
  '            </TouchableOpacity>',
  '            <View style={styles.menuVersionBox}>',
  '              <Text style={[styles.menuVersionLabel, { color: theme.subText }]}>Phiên b?n PickleTour</Text>',
  '              <Text style={[styles.menuVersionValue, { color: theme.text }]}>v' + PICKLETOUR_VERSION + '</Text>',
  '            </View>',
  '          </View>',
  '        </View>',
  '      </Modal>',
  '      <Modal transparent visible={Boolean(reasoningTarget)} animationType="slide" onRequestClose={() => setReasoningTarget(null)}>',
].join('\n');
if (!menuBlockPattern.test(text)) {
  throw new Error('Menu block not found');
}
text = text.replace(menuBlockPattern, menuBlockReplacement);

text = text.replace(/<Text style=\{\[styles\.reasoningModalTitle, \{ color: theme\.text \}\]\}>[\s\S]*?<\/Text>/, '<Text style={[styles.reasoningModalTitle, { color: theme.text }]}>Suy lu?n c?a Pikora</Text>');
text = text.replace(/<Text style=\{\[styles\.reasoningModalSubtitle, \{ color: theme\.subText \}\]\}>[\s\S]*?<\/Text>/, '<Text style={[styles.reasoningModalSubtitle, { color: theme.subText }]}>Hi?n raw <think> và các d?u hi?u Pikora dùng d? tr? l?i.</Text>');
text = text.replace(/<Text style=\{\[styles\.reasoningSectionTitle, \{ color: theme\.text \}\]\}>[\s\S]*?<\/Text>/, '<Text style={[styles.reasoningSectionTitle, { color: theme.text }]}>Các bu?c x? lý</Text>');
text = text.replace(/compactText\(step\?\.label \|\| step\?\.tool \|\| [^,]+, 140\)/, 'compactText(step?.label || step?.tool || "Bu?c x? lý", 140)');
text = text.replace(/<Text style=\{\[styles\.reasoningSectionTitle, \{ color: theme\.text \}\]\}>[\s\S]*?<\/Text>/, '<Text style={[styles.reasoningSectionTitle, { color: theme.text }]}>N?i dung <think></Text>');
text = text.replace(/<Text style=\{\[styles\.reasoningEmptyText, \{ color: theme\.subText \}\]\}>[\s\S]*?<\/Text>/, '<Text style={[styles.reasoningEmptyText, { color: theme.subText }]}>Tin nh?n này không có ph?n suy lu?n chi ti?t d? hi?n th?.</Text>');

fs.writeFileSync(path, text, 'utf8');
console.log('updated mobile chat assistant');

