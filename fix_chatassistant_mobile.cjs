const fs = require('fs');
const path = 'pickletour-app-mobile/components/chatbot/ChatAssistant.jsx';
let text = fs.readFileSync(path, 'utf8');

text = text.replace(/<Text style=\{styles\.headerSubtitle\}>[\s\S]*?<\/Text>/, [
  '<Text style={styles.headerSubtitle}>',
  '  {isTyping || isSending || isStreaming',
  '    ? "Đang trả lời..."',
  '    : "Luôn sẵn sàng hỗ trợ"}',
  '</Text>',
].join('\n'));

text = text.replace(/<Text style=\{\{ marginTop: 8, color: theme\.subText, fontSize: 13 \}\}>[\s\S]*?<\/Text>/, [
  '<Text style={{ marginTop: 8, color: theme.subText, fontSize: 13 }}>',
  '  {"Đang tải hội thoại..."}',
  '</Text>',
].join('\n'));

text = text.replace(/<QuickReplyButton[\s\S]*?icon="trophy-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="trophy-outline"',
  '  text={"Giải đấu"}',
  '  onPress={() => handleQuickReply("Các giải đấu sắp tới")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="calendar-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="calendar-outline"',
  '  text={"Lịch thi đấu"}',
  '  onPress={() => handleQuickReply("Lịch thi đấu của tôi")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="help-circle-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="help-circle-outline"',
  '  text={"Luật chơi"}',
  '  onPress={() => handleQuickReply("Luật pickleball cơ bản")}',
  '  theme={theme}',
  '/>',
].join('\n'));
text = text.replace(/<QuickReplyButton[\s\S]*?icon="stats-chart-outline"[\s\S]*?\/>/, [
  '<QuickReplyButton',
  '  icon="stats-chart-outline"',
  '  text={"Xếp hạng"}',
  '  onPress={() => handleQuickReply("Xếp hạng của tôi")}',
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
  '                  {"Đã chạm giới hạn phiên · Bạn đã dùng hết 15 tin nhắn cho lượt này."}',
  '                </Text>',
  '                {sessionLimitInfo?.resetAt ? (',
  '                  <Text style={{ fontSize: 12, color: "#ef4444", marginTop: 2 }}>',
  '                    {"Có thể chat lại sau " + formatTimeAmPmFromISO(sessionLimitInfo.resetAt)}',
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
  '                {reasoningMode === "force_reasoner" ? "Reasoner bật" : "Tự động"}',
  '              </Text>',
  '            </TouchableOpacity>',
  '            <Text style={[styles.reasonerHint, { color: theme.subText }]}>',
  '              {reasoningMode === "force_reasoner" ? "Tin nhắn tiếp theo sẽ suy luận sâu hơn." : "Bật khi bạn muốn Pikora suy luận sâu."}',
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
  '                  placeholder={"Nhập câu hỏi của bạn..."}',
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
  '            <Text style={[styles.menuTitle, { color: theme.subText }]}>Tùy chọn</Text>',
  '            <TouchableOpacity style={styles.menuItem} onPress={handleClearChat}>',
  '              <Ionicons name="trash-outline" size={18} color="#e53935" style={styles.menuItemIcon} />',
  '              <Text style={[styles.menuItemText, styles.menuItemTextDanger]}>Xóa toàn bộ hội thoại</Text>',
  '            </TouchableOpacity>',
  '            <TouchableOpacity style={styles.menuItem} onPress={handleFeedback}>',
  '              <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.subText} style={styles.menuItemIcon} />',
  '              <Text style={[styles.menuItemText, { color: theme.text }]}>Gửi feedback</Text>',
  '            </TouchableOpacity>',
  '            <View style={styles.menuVersionBox}>',
  '              <Text style={[styles.menuVersionLabel, { color: theme.subText }]}>Phiên bản PickleTour</Text>',
  '              <Text style={[styles.menuVersionValue, { color: theme.text }]}>v{PICKLETOUR_VERSION}</Text>',
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

fs.writeFileSync(path, text, 'utf8');
console.log('updated mobile chat assistant');
